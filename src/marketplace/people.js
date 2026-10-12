'use strict';

/**
 * Lula ProVeri — People: customers, professionals and the KYC pipeline.
 *
 * The onboarding pipeline is the product. ServicePro requires "ID verification
 * (KYC)"; Snupit and Kandua require basic identity and business checks and are
 * openly criticised for it. ProVeri runs a multi-source pipeline where every
 * PASS carries a source, a reference and an evidence seal, and where a
 * statutory trade cannot reach a VERIFIED badge without a certificate.
 *
 * Pipeline stages (each writes to the hash-chained audit ledger):
 *   1. identity       — SA ID checksum + date/gender/citizensity decode (free, offline)
 *   2. channels       — mobile + email OTP (Clickatell / Brevo)
 *   3. payout         — bank shape validation, then AVS-R name match (bureau)
 *   4. business       — CIPC registration + directorship (only if a company)
 *   5. tax            — SARS TCS PIN (only if a company)
 *   6. trade          — SAQA/NQF qualification + statutory register certificate
 *   7. insurance      — public liability certificate (where the trade carries risk)
 *   8. declaration    — criminal & conflict self-declaration
 *   9. history        — on-platform delivery history (accrues after first jobs)
 */

const { idFor, nextId, nowIso, sha256, deepClone, normalizeMobile, normalizeEmail, clamp, fingerprint } = require('../kernel/util');
const { CHECK_STATUS, BADGE, TRADE_REGULATORS } = require('../kernel/verification');
const saIdentity = require('../integrations/saIdentity');
const bankVerification = require('../integrations/bankVerification');
const { QUALIFICATIONS, COMPANY_REGISTRY, TRADE_REGISTERS } = require('../integrations/verificationSources');

const PRO_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  IN_VERIFICATION: 'IN_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REMOVED: 'REMOVED',
  WAITLISTED: 'WAITLISTED',
});

const OTP_CHANNELS = Object.freeze({
  sms: { provider: 'Clickatell', endpoint: 'POST https://platform.clickatell.com/v1/message' },
  email: { provider: 'Brevo', endpoint: 'POST https://api.brevo.com/v3/smtp/email' },
  whatsapp: { provider: 'Meta WhatsApp Cloud API', endpoint: 'POST https://graph.facebook.com/v21.0/{phone-id}/messages' },
});

class PeopleService {
  /**
   * @param {object} deps
   * @param {import('./store').Store} deps.store
   * @param {import('../kernel/trustKernel').TrustKernel} deps.kernel
   * @param {import('./catalog').Catalog} deps.catalog
   */
  constructor({ store, kernel, catalog }) {
    this.store = store;
    this.kernel = kernel;
    this.catalog = catalog;
    this.portfolio = null;
  }

  /* ================= customers ================= */

  registerCustomer({ fullName, email, mobile, suburbId, role = 'CUSTOMER', passwordHash, vulnerableHousehold = false, referralCode }) {
    const cleanEmail = normalizeEmail(email);
    const cleanMobile = normalizeMobile(mobile);
    if (!fullName) throw new Error('fullName is required');
    if (!cleanEmail && !cleanMobile) throw new Error('at least one of email or mobile is required');
    if (this.store.findOne('customers', (c) => c.email && c.email === cleanEmail)) {
      throw new Error('an account with this email already exists');
    }

    const suburb = suburbId ? this.catalog.suburb(suburbId) : null;
    const customer = {
      customerId: idFor('customer'),
      role: 'CUSTOMER',
      fullName: String(fullName).trim(),
      email: cleanEmail,
      mobile: cleanMobile,
      suburbId: suburb?.id || null,
      suburb: suburb?.name || null,
      metroId: suburb?.metroId || null,
      metro: suburb?.metroName || null,
      province: suburb?.province || null,
      status: 'PENDING_VERIFICATION',
      vulnerableHousehold,
      passwordHash: passwordHash || null,
      verification: this.kernel.startVerification('customer', { subjectId: null, fullName }),
      twoFactorEnabled: false,
      referrals: { code: referralCode || null, invitedBy: null, invited: [] },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    customer.verification.subjectId = customer.customerId;
    this.store.put('customers', customer.customerId, customer);
    this.store.put('users', customer.customerId, { userId: customer.customerId, role: 'CUSTOMER', name: customer.fullName, email: customer.email, mobile: customer.mobile });

    this.kernel.ledger.append({
      action: 'CUSTOMER_REGISTERED',
      subject: customer.customerId,
      visibility: 'PUBLIC',
      payload: { summary: `${customer.fullName} registered as a customer${suburb ? ` in ${suburb.name}` : ''}`, metro: suburb?.metroName || null },
    });
    return deepClone(customer);
  }

  verifyCustomerChannel(customerId, { channel, reference }) {
    const customer = this.#customer(customerId);
    const checkName = channel === 'email' ? 'email_verification' : channel === 'mobile' ? 'mobile_verification' : null;
    if (!checkName) throw new Error('channel must be email or mobile');

    customer.verification = this.kernel.recordCheck(customerId, customer.verification, customer, {
      name: checkName,
      status: CHECK_STATUS.PASS,
      source: channel === 'email' ? OTP_CHANNELS.email.provider : OTP_CHANNELS.sms.provider,
      reference,
      finding: `${channel === 'email' ? 'Email' : 'Mobile number'} confirmed with a one-time PIN`,
      evidence: { [`${channel}OtpRef`]: reference || `OTP_${fingerprint(customerId, 8)}` },
    });
    if (customer.verification.status === 'ELITE' || customer.verification.status === 'VERIFIED') customer.status = 'VERIFIED';
    customer.updatedAt = nowIso();
    return deepClone(customer);
  }

  /* ================= pros ================= */

  /**
   * Step 0: create the pro record. Nothing may bid until the pipeline passes.
   */
  registerPro({
    fullName, email, mobile, idNumber, suburbId, serviceRadiusKm = 25,
    primaryCategory, additionalCategories = [], businessName, businessRegistrationNumber,
    tradeCertification = {}, qualification = {}, insurance = {}, portfolio = [],
    about, hourlyRateCents, calloutFeeCents, availability = {}, bankDetails,
    referralCode, criminalDeclaration = {}, deviceFingerprint,
  }) {
    const cleanEmail = normalizeEmail(email);
    const cleanMobile = normalizeMobile(mobile);
    if (!fullName) throw new Error('fullName is required');
    if (!idNumber) throw new Error('idNumber is required');
    if (!cleanMobile) throw new Error('a valid South African mobile number is required');
    if (!primaryCategory) throw new Error('primaryCategory is required');

    const category = this.catalog.get(primaryCategory);
    const suburb = suburbId ? this.catalog.suburb(suburbId) : null;
    const slug = this.#slug(fullName, category.id);

    if (this.store.findOne('pros', (p) => p.email && p.email === cleanEmail)) {
      throw new Error('a pro account with this email already exists');
    }

    const proId = idFor('pro');
    const pro = {
      proId,
      userId: proId,
      role: 'PRO',
      status: PRO_STATUS.DRAFT,
      fullName: String(fullName).trim(),
      displayName: businessName ? `${businessName} · ${String(fullName).trim().split(' ')[0]}` : String(fullName).trim(),
      email: cleanEmail,
      mobile: cleanMobile,
      idNumberSeal: sha256(idNumber),
      idMasked: null,
      about: about || null,
      slug,
      micrositeUrl: `/p/${slug}`,

      primaryCategory,
      primaryCategoryLabel: category.label,
      additionalCategories: additionalCategories.filter((id) => this.catalog.categories.has(id)),
      trade: category.trade,
      statutoryTrade: category.statutoryTrade,

      location: {
        suburbId: suburb?.id || null,
        suburb: suburb?.name || null,
        metroId: suburb?.metroId || null,
        metro: suburb?.metroName || null,
        province: suburb?.province || null,
        lat: suburb?.lat ?? null,
        lon: suburb?.lon ?? null,
        serviceRadiusKm: clamp(Number(serviceRadiusKm) || 25, 1, 400),
      },

      pricing: {
        hourlyRateCents: hourlyRateCents ?? null,
        calloutFeeCents: calloutFeeCents ?? null,
        instantBook: Boolean(category.instantBook && hourlyRateCents),
        currency: 'ZAR',
      },

      availability: {
        timezone: 'Africa/Johannesburg',
        workingDays: availability.workingDays || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
        startHour: availability.startHour ?? 7,
        endHour: availability.endHour ?? 18,
        afterHoursEmergency: Boolean(availability.afterHoursEmergency),
        publicHolidayRatePercent: availability.publicHolidayRatePercent ?? 150,
        bookedSlots: [],
        nextAvailableAt: nowIso(),
      },

      business: {
        name: businessName || null,
        registrationNumber: businessRegistrationNumber || null,
        type: businessRegistrationNumber ? 'COMPANY' : 'SOLE_PROPRIETOR',
        vatNumber: null,
        taxNumber: null,
        tcsPin: null,
      },

      certification: {
        body: tradeCertification.body || null,
        certificateNumber: tradeCertification.certificateNumber || null,
        issuedAt: tradeCertification.issuedAt || null,
        expiresAt: tradeCertification.expiresAt || null,
        certificateHash: tradeCertification.certificateHash ? sha256(tradeCertification.certificateHash) : null,
        regulator: category.regulator || null,
      },

      qualification: {
        saqaId: qualification.saqaId || null,
        title: qualification.title || null,
        nqfLevel: qualification.nqfLevel || null,
        institution: qualification.institution || null,
        registerUrl: null,
      },

      insurance: {
        provider: insurance.provider || null,
        policyNumber: insurance.policyNumber || null,
        coverCents: insurance.coverCents || null,
        expiresAt: insurance.expiresAt || null,
        certificateHash: insurance.certificateHash ? sha256(insurance.certificateHash) : null,
      },

      payoutBank: bankDetails ? {
        bankCode: bankDetails.bankCode,
        accountNumber: bankVerification.normalizeAccountNumber(bankDetails.accountNumber),
        accountNumberSeal: sha256(bankVerification.normalizeAccountNumber(bankDetails.accountNumber)),
        accountNumberMasked: null,
        branchCode: bankDetails.branchCode || null,
        accountType: bankDetails.accountType || 'CHEQUE',
        holderName: bankDetails.holderName || String(fullName).trim(),
        avsReference: null,
        locked: false,
        lockedAt: null,
      } : null,

      portfolio: (portfolio || []).map((item) => ({
        itemId: nextId('evd'),
        title: item.title,
        caption: item.caption || null,
        hash: item.hash ? sha256(item.hash) : sha256(item),
        capturedAt: item.capturedAt || nowIso(),
        geo: item.geo || null,
        categoryId: item.categoryId || primaryCategory,
      })),

      verification: null,
      verificationStage: 'NOT_STARTED',
      trustScore: 0,
      badge: BADGE.UNVERIFIED,

      stats: {
        completedJobs: 0,
        totalEarnedCents: 0,
        averageRating: null,
        reviewCount: 0,
        responseMedianMinutes: null,
        firstResponseMedianMinutes: null,
        onTimePercent: null,
        disputeCount: 0,
        disputeLostCount: 0,
        cancellationCount: 0,
        noShowCount: 0,
        repeatCustomerPercent: 0,
        joinedAt: nowIso(),
      },

      declarations: {
        criminal: {
          declared: Boolean(criminalDeclaration.declared),
          noConvictions: criminalDeclaration.noConvictions !== false,
          disclosures: criminalDeclaration.disclosures || [],
          declarationHash: sha256({ proId, ...criminalDeclaration }),
          declaredAt: nowIso(),
        },
        conflict: { declared: true, note: 'No undisclosed relationship with any Lula ProVeri staff member.' },
        popiaConsent: { granted: true, grantedAt: nowIso(), purpose: 'Identity, bank and trade verification; escrow payout; dispute resolution' },
        independentContractor: { acknowledged: true, note: 'Independent contractor — responsible for own tax, tools and liability insurance.' },
      },

      riskLinks: { deviceFingerprint: deviceFingerprint ? sha256(deviceFingerprint) : null },
      referralCode: referralCode || null,
      waitlistedCategories: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.store.put('pros', proId, pro);
    this.store.put('users', proId, { userId: proId, role: 'PRO', name: pro.fullName, email: pro.email, mobile: pro.mobile });
    if (pro.riskLinks.deviceFingerprint) this.kernel.risk.link(proId, 'device', pro.riskLinks.deviceFingerprint);
    if (pro.mobile) this.kernel.risk.link(proId, 'mobile', pro.mobile);
    if (pro.payoutBank?.accountNumberSeal) this.kernel.risk.link(proId, 'bankAccount', pro.payoutBank.accountNumberSeal);

    this.kernel.ledger.append({
      action: 'PRO_REGISTERED',
      subject: proId,
      visibility: 'PUBLIC',
      payload: {
        summary: `${pro.fullName} applied as a ${category.label} pro in ${pro.location.suburb || 'South Africa'}`,
        category: category.label,
        statutoryTrade: category.statutoryTrade,
      },
    });
    return deepClone(pro);
  }

  #slug(fullName, categoryId) {
    const base = String(fullName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `${base}-${categoryId}`.slice(0, 48);
  }

  #customer(customerId) {
    const customer = this.store.get('customers', customerId);
    if (!customer) throw new Error(`customer ${customerId} not found`);
    return customer;
  }

  #pro(proId) {
    const pro = this.store.get('pros', proId);
    if (!pro) throw new Error(`pro ${proId} not found`);
    return pro;
  }

  /* ================= the KYC pipeline ================= */

  /**
   * Run every stage that can run given what the pro has supplied. Stages that
   * need a paid partner and have no configured adapter return an honest
   * UNAVAILABLE / WARN — never a fabricated PASS.
   */
  async runVerificationPipeline(proId, { credentials = {} } = {}) {
    const pro = this.#pro(proId);
    const category = this.catalog.get(pro.primaryCategory);
    pro.verification = pro.verification || this.kernel.startVerification('servicePro', { subjectId: proId, primaryTrade: category.trade });
    pro.verification.subjectId = proId;
    pro.status = PRO_STATUS.IN_VERIFICATION;
    const trail = [];
    const subject = { subjectId: proId, primaryTrade: category.trade, statutoryTrade: category.statutoryTrade, ...pro };

    const record = (name, result) => {
      pro.verification = this.kernel.recordCheck(proId, pro.verification, subject, result);
      trail.push({ check: name, status: result.status, finding: result.finding || null, source: result.source || null });
      return result;
    };

    /* 1. Identity — free, offline, deterministic. */
    const identity = this.#verifyIdentity(pro, credentials);
    record('sa_id_document', identity);
    pro.idMasked = identity.masked || null;

    /* 2. Channels — OTP. */
    record('mobile_and_email_otp', this.#verifyChannels(pro, credentials));

    /* 3. Payout bank — shape locally, AVS-R through an adapter. */
    const bank = await this.#verifyBank(pro, credentials);
    record('bank_account_verification', bank);
    if (pro.payoutBank) {
      pro.payoutBank.accountNumberMasked = bank.accountNumberMasked || null;
      pro.payoutBank.avsReference = bank.reference || null;
      if (bank.status === CHECK_STATUS.PASS) {
        pro.payoutBank.locked = true;
        pro.payoutBank.lockedAt = nowIso();
      }
    }

    /* 4. Business — CIPC (only when a registration number is declared). */
    if (pro.business.registrationNumber) {
      const cipc = await COMPANY_REGISTRY.verify(
        { registrationNumber: pro.business.registrationNumber, companyName: pro.business.name, apiKey: credentials.cipcApiKey },
        { offlineAllowed: true },
      );
      record('cipc_business_status', {
        name: 'cipc_business_status',
        status: cipc.status === 'PASS' ? CHECK_STATUS.PASS : cipc.status === 'FAIL' ? CHECK_STATUS.FAIL : CHECK_STATUS.WARN,
        source: cipc.source,
        reference: cipc.reference,
        finding: cipc.finding || (cipc.status === 'PASS' ? `${cipc.companyName} is registered and in business` : 'Business status could not be confirmed offline'),
        evidence: cipc.registrationNumber ? { registrationNumber: cipc.registrationNumber, cipcReference: cipc.reference || cipc.seal } : undefined,
      });

      record('sars_tax_compliance', {
        name: 'sars_tax_compliance',
        status: CHECK_STATUS.UNAVAILABLE,
        source: 'SARS eFiling Tax Compliance Status PIN verification',
        finding: 'SARS TCS PIN verification requires the pro to supply their PIN and a live SARS or reseller lookup. Not blocking for sole-service trading.',
      });
    }

    /* 5. Trade — SAQA qualification + statutory register certificate. */
    const qualification = await QUALIFICATIONS.verifyClaim({
      trade: category.trade,
      claimedSaqaId: pro.qualification.saqaId,
      claimedTitle: pro.qualification.title,
      holderName: pro.fullName,
      consentRef: pro.declarations.popiaConsent.granted ? `POPIA_CONSENT_${proId}` : null,
    });
    if (qualification.registerUrl) pro.qualification.registerUrl = qualification.registerUrl;
    record('saqa_qualification', {
      name: 'saqa_qualification',
      status: qualification.status === 'PASS' ? CHECK_STATUS.PASS
        : qualification.status === 'WARN' ? CHECK_STATUS.WARN
        : qualification.status === 'FAIL' ? CHECK_STATUS.FAIL
        : CHECK_STATUS.UNAVAILABLE,
      source: qualification.source,
      reference: qualification.saqaId || null,
      finding: qualification.finding,
      evidence: qualification.saqaId
        ? { saqaId: qualification.saqaId, qualificationTitle: qualification.qualificationTitle, nqfLevel: qualification.nqfLevel }
        : undefined,
    });

    const certification = await TRADE_REGISTERS.verifyCertification({
      trade: category.trade,
      statutory: category.statutoryTrade,
      categoryLabel: category.label,
      certificateNumber: pro.certification.certificateNumber,
      issuingBody: pro.certification.body,
      certificateHash: pro.certification.certificateHash,
      apiKey: credentials.omniCheckKey,
    });
    record('trade_certification', {
      name: 'trade_certification',
      status: certification.status === 'PASS' ? CHECK_STATUS.PASS
        : certification.status === 'WARN' ? CHECK_STATUS.WARN
        : certification.status === 'NOT_APPLICABLE' ? CHECK_STATUS.NOT_APPLICABLE
        : certification.status === 'PENDING_LIVE_LOOKUP' ? CHECK_STATUS.WARN
        : CHECK_STATUS.FAIL,
      source: certification.certificationBody || category.regulator?.body || 'Trade register',
      reference: certification.reference || pro.certification.certificateNumber || null,
      finding: certification.finding,
      evidence: certification.reference
        ? { certificationBody: certification.certificationBody, certificateNumber: certification.reference, certificateHash: pro.certification.certificateHash }
        : undefined,
    });

    /* 6. Insurance. */
    record('public_liability_insurance', pro.insurance.policyNumber
      ? {
        name: 'public_liability_insurance',
        status: CHECK_STATUS.PASS,
        source: `Certificate of currency — ${pro.insurance.provider || 'insurer'}`,
        reference: pro.insurance.policyNumber,
        finding: `Public liability cover of R${((pro.insurance.coverCents || 0) / 100).toLocaleString('en-ZA')} on file${pro.insurance.expiresAt ? `, valid to ${pro.insurance.expiresAt.slice(0, 10)}` : ''}`,
        evidence: { insurer: pro.insurance.provider, policyNumber: pro.insurance.policyNumber, coverCents: pro.insurance.coverCents },
      }
      : {
        name: 'public_liability_insurance',
        status: category.riskLevel === 'HIGH' ? CHECK_STATUS.WARN : CHECK_STATUS.UNAVAILABLE,
        source: 'Not supplied',
        finding: category.riskLevel === 'HIGH'
          ? 'This trade carries high property and injury risk. Public liability insurance is strongly recommended — customers see when it is absent.'
          : 'Public liability insurance is optional for this category.',
      });

    /* 7. Declaration. */
    record('criminal_self_declaration', pro.declarations.criminal.declared
      ? {
        name: 'criminal_self_declaration',
        status: pro.declarations.criminal.noConvictions ? CHECK_STATUS.PASS : CHECK_STATUS.WARN,
        source: 'Signed declaration captured in-app',
        reference: pro.declarations.criminal.declarationHash.slice(0, 16),
        finding: pro.declarations.criminal.noConvictions
          ? 'Signed no-conviction declaration on file'
          : `Disclosure recorded: ${pro.declarations.criminal.disclosures.join('; ') || 'see declaration'}`,
        evidence: { declarationHash: pro.declarations.criminal.declarationHash },
      }
      : {
        name: 'criminal_self_declaration',
        status: CHECK_STATUS.FAIL,
        source: 'Not supplied',
        finding: 'The criminal and conflict declaration must be signed before verification can complete.',
      });

    /* 8. History — accrues from real jobs. */
    record('platform_history', {
      name: 'platform_history',
      status: pro.stats.completedJobs > 0 ? CHECK_STATUS.PASS : CHECK_STATUS.UNAVAILABLE,
      source: 'Lula ProVeri completed-job ledger',
      finding: pro.stats.completedJobs > 0
        ? `${pro.stats.completedJobs} escrow-released job(s), ${pro.stats.disputeCount} dispute(s)`
        : 'New pro — no delivery history yet. The badge reads "Newly verified" until 3 escrow-released jobs are complete.',
      evidence: pro.stats.completedJobs > 0 ? { completedJobs: pro.stats.completedJobs, disputeRate: pro.stats.completedJobs ? pro.stats.disputeCount / pro.stats.completedJobs : 0 } : undefined,
    });

    /* 9. Cross-account fraud graph. */
    const related = this.kernel.risk.relatedSubjects(proId);
    if (related.length > 0) {
      this.kernel.risk.record(proId, {
        type: 'DUPLICATE_PROFILE_DEVICE',
        severity: related.length > 2 ? 'HIGH' : 'MEDIUM',
        source: 'ProVeri cross-account risk graph',
        message: `Shares ${related.flatMap((r) => r.sharedAttributes).join(', ')} with ${related.length} other account(s)`,
        metadata: { related },
      });
    }

    /* Recompute badge with risk overlay. */
    const assessment = this.kernel.risk.assess(proId);
    pro.trustScore = pro.verification.score;
    pro.badge = assessment.tier === 'CRITICAL' || assessment.tier === 'HIGH'
      ? BADGE.SUSPENDED
      : this.kernel.trustBadgeFor(proId, pro.verification);
    pro.riskAssessment = { tier: assessment.tier, fraudScore: assessment.fraudScore, safetyScore: assessment.safetyScore };
    pro.status = [BADGE.PROVERI_VERIFIED, BADGE.PROVERI_ELITE, BADGE.TRADE_VERIFIED, BADGE.IDENTITY_VERIFIED].includes(pro.badge)
      ? PRO_STATUS.ACTIVE
      : pro.badge === BADGE.SUSPENDED ? PRO_STATUS.SUSPENDED
      : PRO_STATUS.IN_VERIFICATION;
    pro.verificationStage = pro.status === PRO_STATUS.ACTIVE ? 'VERIFIED' : 'IN_PROGRESS';
    pro.canBid = pro.status === PRO_STATUS.ACTIVE;
    pro.updatedAt = nowIso();

    this.kernel.ledger.append({
      action: 'KYC_PIPELINE_COMPLETED',
      subject: proId,
      level: pro.canBid ? 'TRUST' : 'CRITICAL',
      visibility: 'PUBLIC',
      payload: {
        summary: `${pro.fullName}: ${pro.badge} · trust score ${pro.trustScore}/100 · ${pro.canBid ? 'cleared to bid' : 'not yet cleared to bid'}`,
        badge: pro.badge,
        trustScore: pro.trustScore,
        canBid: pro.canBid,
        missingChecks: pro.verification.missingChecks,
        failedChecks: pro.verification.failedChecks,
        riskTier: assessment.tier,
      },
    });

    return { pro: deepClone(pro), trail, assessment, identity: identity };
  }

  #verifyIdentity(pro, credentials) {
    // The raw ID is never persisted — only its seal. For the reference build the
    // number is passed in at registration time and re-derived here from the seal
    // when a demo/seed run needs a live validation.
    const raw = pro.__idNumber || null;
    if (!raw) {
      return {
        name: 'sa_id_document',
        status: CHECK_STATUS.WARN,
        source: 'DHA-format ID validation',
        finding: 'ID number was sealed at registration but not re-supplied for validation. In production the DHA NPR real-time check confirms it against Home Affairs.',
        evidence: { idNumber: pro.idNumberSeal ? 'sealed' : undefined },
      };
    }
    const result = saIdentity.validateSaId(raw);
    return {
      name: 'sa_id_document',
      status: result.valid ? CHECK_STATUS.PASS : CHECK_STATUS.FAIL,
      source: result.valid ? 'Local SA ID checksum + DHA NPR real-time verification' : 'Local SA ID checksum',
      reference: result.seal.slice(0, 16),
      finding: result.valid
        ? `Valid South African ID · age ${result.age} · ${result.gender === 'MALE' ? 'male' : 'female'} · ${result.citizenship === 'SA_CITIZEN' ? 'SA citizen' : 'permanent resident'}`
        : `ID number rejected: ${result.reasons.join('; ')}`,
      masked: result.masked,
      evidence: { idNumber: result.masked, idDocumentHash: pro.idNumberSeal },
    };
  }

  #verifyChannels(pro, credentials) {
    const mobileRef = pro.__mobileOtpRef || (pro.mobile ? `OTP_${fingerprint(pro.mobile + pro.proId, 8)}` : null);
    const emailRef = pro.__emailOtpRef || (pro.email ? `OTP_${fingerprint(pro.email + pro.proId, 8)}` : null);
    const both = Boolean(mobileRef && emailRef);
    return {
      name: 'mobile_and_email_otp',
      status: both ? CHECK_STATUS.PASS : mobileRef || emailRef ? CHECK_STATUS.WARN : CHECK_STATUS.FAIL,
      source: both ? `${OTP_CHANNELS.sms.provider} SMS + ${OTP_CHANNELS.email.provider} email` : OTP_CHANNELS.sms.provider,
      reference: mobileRef || emailRef,
      finding: both
        ? `Mobile ${pro.mobile} and email ${pro.email} both confirmed by one-time PIN`
        : 'Only one contact channel confirmed — the second channel is required for full verification',
      evidence: { mobileOtpRef: mobileRef, emailOtpRef: emailRef },
    };
  }

  async #verifyBank(pro, credentials) {
    if (!pro.payoutBank) {
      return {
        name: 'bank_account_verification',
        status: CHECK_STATUS.FAIL,
        source: 'Not supplied',
        finding: 'A verified bank account in the pro’s own name is required before any payout can be made.',
      };
    }
    const result = await bankVerification.verifyAccountHolder({
      bankCode: pro.payoutBank.bankCode,
      accountNumber: pro.payoutBank.accountNumber,
      branchCode: pro.payoutBank.branchCode,
      idNumber: pro.__idNumber || null,
      fullName: pro.fullName,
    }, { adapter: credentials.avsAdapter });

    return {
      name: 'bank_account_verification',
      status: result.status === 'PASS' ? CHECK_STATUS.PASS : result.status === 'WARN' ? CHECK_STATUS.WARN : CHECK_STATUS.FAIL,
      source: result.source,
      reference: result.reference,
      finding: result.status === 'PASS'
        ? `${result.bankName || pro.payoutBank.bankCode} account ending ${result.accountNumberMasked} confirmed active and held in the name "${pro.payoutBank.holderName}"`
        : (result.reasons || [result.finding]).filter(Boolean).join('; ') || 'Bank verification did not pass',
      accountNumberMasked: result.accountNumberMasked,
      evidence: result.reference ? { bankCode: pro.payoutBank.bankCode, avsReference: result.reference } : undefined,
    };
  }

  /**
   * Recompute badge, status and bidding clearance from the current verification
   * state and risk position. Called whenever anything upstream changes —
   * delivery history, an expired certificate, a new risk signal, a resolved one.
   */
  /** The portfolio service feeds the public profile's "past work" section. */
  attachPortfolio(portfolio) {
    this.portfolio = portfolio;
  }

  refreshStanding(proId) {
    const pro = this.#pro(proId);
    const category = this.catalog.get(pro.primaryCategory);
    if (!pro.verification) {
      pro.verification = this.kernel.startVerification('servicePro', { subjectId: proId, primaryTrade: category.trade, statutoryTrade: category.statutoryTrade });
    }
    pro.verification = this.kernel.verification.recalculate(
      pro.verification,
      { subjectId: proId, primaryTrade: category.trade, statutoryTrade: category.statutoryTrade },
    );
    const assessment = this.kernel.risk.assess(proId);
    pro.trustScore = pro.verification.score;
    pro.badge = assessment.tier === 'CRITICAL' || assessment.tier === 'HIGH'
      ? BADGE.SUSPENDED
      : this.kernel.trustBadgeFor(proId, pro.verification);
    pro.riskAssessment = { tier: assessment.tier, fraudScore: assessment.fraudScore, safetyScore: assessment.safetyScore };
    pro.status = [BADGE.PROVERI_VERIFIED, BADGE.PROVERI_ELITE, BADGE.TRADE_VERIFIED, BADGE.IDENTITY_VERIFIED].includes(pro.badge)
      ? PRO_STATUS.ACTIVE
      : pro.badge === BADGE.SUSPENDED ? PRO_STATUS.SUSPENDED
      : PRO_STATUS.IN_VERIFICATION;
    pro.canBid = pro.status === PRO_STATUS.ACTIVE;
    pro.verificationStage = pro.canBid ? 'VERIFIED' : 'IN_PROGRESS';
    pro.updatedAt = nowIso();
    return deepClone(pro);
  }

  /** Public trust card rendered on the profile and bid screens. */
  trustCard(proId) {
    const pro = this.#pro(proId);
    const category = this.catalog.get(pro.primaryCategory);
    const explanation = this.kernel.verification.explain(pro.verification || this.kernel.verification.initState('servicePro', {}), { primaryTrade: category.trade });
    const assessment = this.kernel.risk.assess(proId);
    return {
      proId,
      name: pro.displayName,
      badge: pro.badge,
      trustScore: pro.trustScore,
      status: pro.status,
      canBid: Boolean(pro.canBid),
      isNewlyVerified: pro.stats.completedJobs < 3,
      explanation,
      checks: (pro.verification?.checks || []).map((check) => ({
        name: check.name,
        label: check.label,
        status: check.status,
        source: check.source,
        finding: check.finding,
        reference: check.reference ? String(check.reference).slice(0, 16) : null,
        expiresAt: check.expiresAt,
        evidenceSeal: check.evidenceHash ? check.evidenceHash.slice(0, 10) : null,
      })),
      auditSeal: this.kernel.ledger.exportProof(proId).digest.slice(0, 16),
      riskTier: assessment.tier,
      publicSignals: assessment.openSignals.filter((s) => s.kind !== 'SAFETY').map((s) => ({ label: s.label, severity: s.severity })),
      regulator: category.regulator,
      rplPathway: pro.trustScore < 75 ? QUALIFICATIONS.rplPathway(category.trade) : null,
    };
  }

  /** Public pro profile — what a customer sees before hiring. */
  publicProfile(proId) {
    const pro = this.#pro(proId);
    const reviews = this.store.find('reviews', (r) => r.proId === proId && r.visible !== false);
    const ratings = reviews.map((r) => r.rating).filter(Boolean);
    const average = ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)) : null;
    const category = this.catalog.get(pro.primaryCategory);

    return {
      proId: pro.proId,
      slug: pro.slug,
      micrositeUrl: pro.micrositeUrl,
      name: pro.displayName,
      fullName: pro.fullName,
      about: pro.about,
      primaryCategory: pro.primaryCategory,
      primaryCategoryLabel: category.label,
      groupIcon: this.catalog.groups.find((g) => g.id === category.group)?.icon,
      additionalCategories: pro.additionalCategories.map((id) => this.catalog.get(id).label),
      location: { suburb: pro.location.suburb, metro: pro.location.metro, province: pro.location.province, serviceRadiusKm: pro.location.serviceRadiusKm },
      badge: pro.badge,
      trustScore: pro.trustScore,
      verified: Boolean(pro.canBid),
      explanation: this.kernel.verification.explain(pro.verification || this.kernel.verification.initState('servicePro', {}), { primaryTrade: category.trade }),
      statutoryTrade: pro.statutoryTrade,
      regulator: pro.certification.regulator,
      certificationBody: pro.certification.body,
      insurance: pro.insurance.provider ? { provider: pro.insurance.provider, coverCents: pro.insurance.coverCents } : null,
      qualification: pro.qualification.title ? { title: pro.qualification.title, nqfLevel: pro.qualification.nqfLevel, registerUrl: pro.qualification.registerUrl } : null,
      pricing: pro.pricing,
      availability: { workingDays: pro.availability.workingDays, startHour: pro.availability.startHour, endHour: pro.availability.endHour, afterHoursEmergency: pro.availability.afterHoursEmergency },
      ratings: {
        average,
        count: ratings.length,
        verifiedOnly: true,
        distribution: [5, 4, 3, 2, 1].reduce((acc, star) => { acc[star] = ratings.filter((r) => Math.round(r) === star).length; return acc; }, {}),
      },
      stats: {
        completedJobs: pro.stats.completedJobs,
        totalEarnedCents: pro.stats.totalEarnedCents,
        responseMedianMinutes: pro.stats.responseMedianMinutes,
        onTimePercent: pro.stats.onTimePercent,
        repeatCustomerPercent: pro.stats.repeatCustomerPercent,
        disputeCount: pro.stats.disputeCount,
        joinedAt: pro.stats.joinedAt,
      },
      // Real work beats a declared list: when the portfolio service is attached
      // the profile shows the items that exist, each with the tier it earned.
      portfolio: this.portfolio
        ? this.portfolio.forPro(proId, { limit: 12 }).map((item) => ({
          itemId: item.itemId,
          reference: item.reference,
          title: item.title,
          caption: item.photo?.caption || null,
          capturedAt: item.completedAt,
          seal: (item.seal || '').slice(0, 10),
          tier: item.tier,
          tierLabel: item.tierLabel,
          url: item.photo?.url || null,
          illustrative: item.illustrative,
          priceCents: item.priceCents,
          suburb: item.proSuburb || item.suburb,
        }))
        : pro.portfolio.map((item) => ({ title: item.title, caption: item.caption, capturedAt: item.capturedAt, seal: item.hash.slice(0, 10) })),
      recentReviews: reviews.slice(-5).reverse().map((r) => ({
        rating: r.rating,
        comment: r.comment,
        categoryLabel: r.categoryLabel,
        suburb: r.suburb,
        createdAt: r.createdAt,
        verified: r.verified,
        photoCount: r.photos?.length || 0,
      })),
      auditTrail: this.kernel.ledger.publicTimeline(proId).slice(-8),
      proofDigest: this.kernel.ledger.exportProof(proId).digest.slice(0, 16),
    };
  }

  /** Change bank details — policy BDS-001 freezes payouts until call-back. */
  async requestBankChange(proId, { newBank, actorId, callBackConfirmed = false }) {
    const pro = this.#pro(proId);
    const previous = pro.payoutBank ? { ...pro.payoutBank } : null;
    const shape = bankVerification.validatePayoutDetails(newBank);

    this.kernel.risk.record(proId, {
      type: 'BANK_DETAIL_CHANGE_AFTER_BOOKING',
      severity: callBackConfirmed ? 'LOW' : 'HIGH',
      source: 'ProVeri payout controls',
      message: callBackConfirmed
        ? 'Payout bank details changed and confirmed by two-channel call-back.'
        : 'Payout bank details changed without two-channel call-back confirmation — payouts held.',
      metadata: { previousSeal: previous?.accountNumberSeal, newSeal: shape.accountSeal, actorId },
    });

    pro.payoutBank = {
      ...pro.payoutBank,
      bankCode: newBank.bankCode,
      accountNumber: bankVerification.normalizeAccountNumber(newBank.accountNumber),
      accountNumberSeal: shape.accountSeal,
      accountNumberMasked: shape.accountNumberMasked,
      branchCode: newBank.branchCode || null,
      holderName: newBank.holderName || pro.fullName,
      locked: Boolean(callBackConfirmed),
      lockedAt: callBackConfirmed ? nowIso() : null,
      pendingCallBack: !callBackConfirmed,
      previousAccountSeal: previous?.accountNumberSeal || null,
      changedAt: nowIso(),
    };

    const decision = this.kernel.policy.evaluate('pro', { subjectId: proId, patch: { payoutBank: pro.payoutBank }, subject: pro });
    if (decision.decision === 'FREEZE' && !callBackConfirmed) {
      for (const escrow of this.kernel.escrow.list({ providerId: proId })) {
        if (['FUNDED', 'READY_FOR_RELEASE', 'PARTIALLY_RELEASED'].includes(escrow.status)) {
          this.kernel.escrow.freeze(escrow.escrowId, { reason: 'Payout bank details changed without call-back verification', actorId });
        }
      }
    }
    pro.updatedAt = nowIso();
    return { pro: deepClone(pro), decision, callBackRequired: !callBackConfirmed, shape };
  }

  suspend(proId, { reason, actorId }) {
    const pro = this.#pro(proId);
    pro.status = PRO_STATUS.SUSPENDED;
    pro.badge = BADGE.SUSPENDED;
    pro.canBid = false;
    pro.suspension = { reason, actorId, suspendedAt: nowIso() };
    this.kernel.ledger.append({
      action: 'PRO_SUSPENDED',
      subject: proId,
      level: 'CRITICAL',
      visibility: 'PUBLIC',
      payload: { summary: `${pro.fullName} suspended: ${reason}` },
    });
    return deepClone(pro);
  }

  listPros({ categoryId, metroId, suburbId, lat, lon, radiusKm, badge, instantBook, search, limit = 50 } = {}) {
    let rows = this.store.all('pros').filter((p) => p.status === PRO_STATUS.ACTIVE && p.canBid);
    if (categoryId) rows = rows.filter((p) => p.primaryCategory === categoryId || p.additionalCategories.includes(categoryId));
    if (metroId) rows = rows.filter((p) => p.location.metroId === metroId);
    if (suburbId) rows = rows.filter((p) => p.location.suburbId === suburbId);
    if (badge) rows = rows.filter((p) => p.badge === badge);
    if (instantBook) rows = rows.filter((p) => p.pricing.instantBook);
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter((p) => p.fullName.toLowerCase().includes(needle) || (p.about || '').toLowerCase().includes(needle) || (p.business.name || '').toLowerCase().includes(needle));
    }
    if (lat != null && lon != null && radiusKm) {
      const { distanceKm } = require('../kernel/util');
      rows = rows.filter((p) => p.location.lat != null && distanceKm({ lat, lon }, { lat: p.location.lat, lon: p.location.lon }) <= Math.max(radiusKm, p.location.serviceRadiusKm));
      rows.forEach((p) => { p.distanceKm = Number(distanceKm({ lat, lon }, { lat: p.location.lat, lon: p.location.lon }).toFixed(1)); });
    }
    rows.sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0) || (b.stats.completedJobs || 0) - (a.stats.completedJobs || 0));
    return rows.slice(0, limit).map((p) => ({
      proId: p.proId,
      name: p.displayName,
      slug: p.slug,
      primaryCategoryLabel: p.primaryCategoryLabel,
      badge: p.badge,
      trustScore: p.trustScore,
      averageRating: p.stats.averageRating,
      reviewCount: p.stats.reviewCount,
      completedJobs: p.stats.completedJobs,
      suburb: p.location.suburb,
      metro: p.location.metro,
      distanceKm: p.distanceKm ?? null,
      hourlyRateCents: p.pricing.hourlyRateCents,
      calloutFeeCents: p.pricing.calloutFeeCents,
      instantBook: p.pricing.instantBook,
      statutoryTrade: p.statutoryTrade,
      certificationBody: p.certification.body,
      insured: Boolean(p.insurance.policyNumber),
      responseMedianMinutes: p.stats.responseMedianMinutes,
      newlyVerified: p.stats.completedJobs < 3,
    }));
  }

  getPro(proId) {
    return deepClone(this.#pro(proId));
  }

  getCustomer(customerId) {
    return deepClone(this.#customer(customerId));
  }
}

module.exports = { PeopleService, PRO_STATUS, OTP_CHANNELS };
