import {
  type AffiliateCampaign,
  type AffiliatePartner,
  CrmConflictError,
  CrmValidationError,
  crmCurrency,
  crmDate,
  crmText,
} from "./types.ts";

export class PartnerRegistry {
  readonly #partners = new Map<string, AffiliatePartner>();
  readonly #campaigns = new Map<string, AffiliateCampaign>();
  readonly #byCode = new Map<string, string>();

  createPartner(value: AffiliatePartner): AffiliatePartner {
    const partner = validatePartner(value);
    if (this.#partners.has(partner.id))
      throw new CrmConflictError("partner id already exists");
    this.#partners.set(partner.id, partner);
    return clonePartner(partner);
  }

  transitionPartner(
    partnerId: string,
    expectedVersion: number,
    status: AffiliatePartner["status"],
    actorId: string,
    at = new Date(),
  ): AffiliatePartner {
    const current = this.requirePartner(partnerId);
    if (current.version !== expectedVersion)
      throw new CrmConflictError("partner version does not match");
    const allowed: Readonly<
      Record<AffiliatePartner["status"], readonly AffiliatePartner["status"][]>
    > = {
      pending: ["active", "terminated"],
      active: ["suspended", "terminated"],
      suspended: ["active", "terminated"],
      terminated: [],
    };
    if (status !== current.status && !allowed[current.status].includes(status))
      throw new CrmConflictError(
        `cannot move partner from ${current.status} to ${status}`,
      );
    crmText(actorId, "partner actor");
    const changed = {
      ...current,
      status,
      activatedAt:
        status === "active"
          ? (current.activatedAt ?? at.toISOString())
          : current.activatedAt,
      terminatedAt: status === "terminated" ? at.toISOString() : undefined,
      version: current.version + 1,
    };
    this.#partners.set(changed.id, changed);
    if (status !== "active")
      for (const [id, campaign] of this.#campaigns)
        if (campaign.partnerId === changed.id && campaign.enabled)
          this.#campaigns.set(id, {
            ...campaign,
            enabled: false,
            version: campaign.version + 1,
          });
    return clonePartner(changed);
  }

  createCampaign(value: AffiliateCampaign): AffiliateCampaign {
    const campaign = validateCampaign(value);
    const partner = this.requirePartner(campaign.partnerId);
    if (partner.status !== "active")
      throw new CrmConflictError("partner is not active");
    if (this.#campaigns.has(campaign.id))
      throw new CrmConflictError("campaign id already exists");
    if (this.#byCode.has(campaign.code))
      throw new CrmConflictError("campaign code already exists");
    if (
      !campaign.countries.every(
        (country) =>
          partner.countries.includes(country) &&
          !partner.blockedCountries.includes(country),
      )
    )
      throw new CrmValidationError("campaign country is outside partner scope");
    this.#campaigns.set(campaign.id, campaign);
    this.#byCode.set(campaign.code, campaign.id);
    return cloneCampaign(campaign);
  }

  updateCampaign(
    campaignId: string,
    expectedVersion: number,
    changes: Partial<
      Omit<AffiliateCampaign, "id" | "partnerId" | "code" | "version">
    >,
  ): AffiliateCampaign {
    const current = this.requireCampaign(campaignId);
    if (current.version !== expectedVersion)
      throw new CrmConflictError("campaign version does not match");
    const changed = validateCampaign({
      ...current,
      ...changes,
      id: current.id,
      partnerId: current.partnerId,
      code: current.code,
      version: current.version + 1,
    });
    this.#campaigns.set(changed.id, changed);
    return cloneCampaign(changed);
  }

  campaignByCode(
    code: string,
    country: string | undefined,
    at = new Date(),
  ): AffiliateCampaign | undefined {
    const id = this.#byCode.get(code.trim().toUpperCase());
    const campaign = id ? this.#campaigns.get(id) : undefined;
    if (!campaign || !campaign.enabled) return undefined;
    if (
      at < new Date(campaign.startsAt) ||
      (campaign.endsAt && at >= new Date(campaign.endsAt))
    )
      return undefined;
    if (
      campaign.countries.length &&
      (!country || !campaign.countries.includes(country.toUpperCase()))
    )
      return undefined;
    return cloneCampaign(campaign);
  }

  partner(partnerId: string): AffiliatePartner | undefined {
    const value = this.#partners.get(partnerId.trim());
    return value ? clonePartner(value) : undefined;
  }
  campaign(campaignId: string): AffiliateCampaign | undefined {
    const value = this.#campaigns.get(campaignId.trim());
    return value ? cloneCampaign(value) : undefined;
  }
  campaignsForPartner(partnerId: string): readonly AffiliateCampaign[] {
    return [...this.#campaigns.values()]
      .filter((campaign) => campaign.partnerId === partnerId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(cloneCampaign);
  }
  private requirePartner(id: string): AffiliatePartner {
    const value = this.#partners.get(crmText(id, "partner id"));
    if (!value) throw new CrmValidationError("partner does not exist");
    return value;
  }
  private requireCampaign(id: string): AffiliateCampaign {
    const value = this.#campaigns.get(crmText(id, "campaign id"));
    if (!value) throw new CrmValidationError("campaign does not exist");
    return value;
  }
}

function validatePartner(value: AffiliatePartner): AffiliatePartner {
  if (value.countries.length === 0 || value.currencies.length === 0)
    throw new CrmValidationError("partner requires countries and currencies");
  return {
    ...value,
    id: crmText(value.id, "partner id"),
    name: crmText(value.name, "partner name"),
    legalName: crmText(value.legalName, "partner legal name"),
    countries: normalized(value.countries, true),
    blockedCountries: normalized(value.blockedCountries, true),
    currencies: normalized(value.currencies, true).map(crmCurrency),
    trackingDomains: normalized(value.trackingDomains),
    paymentCurrency: crmCurrency(value.paymentCurrency),
    createdAt: crmDate(value.createdAt, "partner creation").toISOString(),
  };
}
function validateCampaign(value: AffiliateCampaign): AffiliateCampaign {
  const startsAt = crmDate(value.startsAt, "campaign start");
  const endsAt = value.endsAt
    ? crmDate(value.endsAt, "campaign end")
    : undefined;
  if (endsAt && endsAt <= startsAt)
    throw new CrmValidationError("campaign end must follow start");
  if (
    value.model !== "revenue_share" &&
    (!value.cpaMinor || value.cpaMinor <= 0n)
  )
    throw new CrmValidationError("CPA campaign requires a positive amount");
  if (
    value.model !== "cpa" &&
    (!value.revenueShareBasisPoints ||
      value.revenueShareBasisPoints < 1 ||
      value.revenueShareBasisPoints > 10_000)
  )
    throw new CrmValidationError("revenue share is invalid");
  if (
    !Number.isSafeInteger(value.qualificationDays) ||
    value.qualificationDays < 0
  )
    throw new CrmValidationError("qualification days are invalid");
  return {
    ...value,
    id: crmText(value.id, "campaign id"),
    partnerId: crmText(value.partnerId, "partner id"),
    name: crmText(value.name, "campaign name"),
    code: crmText(value.code, "campaign code").toUpperCase(),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt?.toISOString(),
    countries: normalized(value.countries, true),
    channels: normalized(value.channels),
    landingPage: crmText(value.landingPage, "landing page"),
  };
}
function normalized(values: readonly string[], uppercase = false): string[] {
  return [
    ...new Set(
      values.map((item) => {
        const value = crmText(item, "list item");
        return uppercase ? value.toUpperCase() : value.toLocaleLowerCase();
      }),
    ),
  ].sort();
}
function clonePartner(value: AffiliatePartner): AffiliatePartner {
  return {
    ...value,
    countries: [...value.countries],
    blockedCountries: [...value.blockedCountries],
    currencies: [...value.currencies],
    trackingDomains: [...value.trackingDomains],
  };
}
function cloneCampaign(value: AffiliateCampaign): AffiliateCampaign {
  return {
    ...value,
    countries: [...value.countries],
    channels: [...value.channels],
  };
}
