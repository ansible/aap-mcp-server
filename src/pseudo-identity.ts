import { createHmac } from "node:crypto";

export interface UserInfo {
  ansibleId?: string;
  email?: string;
}

export interface PseudoIdentityResult {
  userPseudoId: string;
  userType: string;
  installerPseudoId: string;
}

/**
 * Service for generating stable, privacy-preserving pseudonymous identifiers
 * using HMAC-SHA-256 with a persistent key.
 */
export class PseudoIdentityService {
  private readonly hmacKey: string | null;
  private readonly installerId: string | null;
  private readonly internalEmailDomains: string[];

  constructor() {
    this.hmacKey = this.loadSaltKey();
    this.installerId = this.loadInstallerId();
    this.internalEmailDomains = this.loadInternalEmailDomains();
  }

  /**
   * Check if the service is enabled (salt key is loaded).
   */
  isEnabled(): boolean {
    return this.hmacKey !== null;
  }

  /**
   * Load salt key from environment variable.
   */
  private loadSaltKey(): string | null {
    const envKey = process.env.TELEMETRY_HMAC_KEY;

    if (!envKey || envKey.trim().length === 0) {
      console.warn(
        "PseudoIdentity: TELEMETRY_HMAC_KEY not set — pseudo IDs will not be added to telemetry events",
      );
      return null;
    }

    return envKey.trim();
  }

  /**
   * Load installer ID from environment variable.
   */
  private loadInstallerId(): string | null {
    const envId = process.env.INSTALLER_ID;

    if (!envId || envId.trim().length === 0) {
      console.warn(
        "PseudoIdentity: INSTALLER_ID not set — installer_pseudo_id will not be added to telemetry events",
      );
      return null;
    }

    return envId.trim();
  }

  /**
   * Get the installer pseudo ID (HMAC-SHA-256 of installer_id).
   * Returns null if either HMAC key or installer ID is missing.
   */
  getInstallerPseudoId(): string {
    if (!this.hmacKey || !this.installerId) {
      return "unknown";
    }
    return this.generatePseudoId(this.installerId);
  }

  /**
   * Generate a stable pseudonymous ID using HMAC-SHA-256.
   * @param identifier - The raw identifier to pseudonymize
   * @returns 64-character hex string
   */
  generatePseudoId(identifier: string): string {
    if (!this.hmacKey) {
      return "anonymous";
    }
    return createHmac("sha256", this.hmacKey).update(identifier).digest("hex");
  }

  /**
   * Load internal email domains from environment variable.
   */
  private loadInternalEmailDomains(): string[] {
    const domainsEnv = process.env.INTERNAL_EMAIL_DOMAINS;
    if (!domainsEnv || domainsEnv.trim().length === 0) {
      console.warn(
        "PseudoIdentity: INTERNAL_EMAIL_DOMAINS not set — all users will be classified as external",
      );
      return [];
    }
    return domainsEnv
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);
  }

  /**
   * Determine user type based on email domain matching against INTERNAL_EMAIL_DOMAINS.
   * @param email - User email address (optional)
   * @returns "internal" | "external"
   */
  determineUserType(email?: string): string {
    if (!email || email.trim().length === 0) {
      return "external";
    }

    const lowerEmail = email.toLowerCase();
    return this.internalEmailDomains.some((domain) =>
      lowerEmail.endsWith(`@${domain}`),
    )
      ? "internal"
      : "external";
  }

  /**
   * Derive complete pseudonymous identity from user info.
   * Returns defaults for pseudo IDs if the salt key is not loaded.
   * @param userInfo - User info extracted from /me/ endpoint
   */
  deriveIdentity(userInfo: UserInfo): PseudoIdentityResult {
    const identifier = userInfo.ansibleId;
    return {
      userPseudoId: identifier
        ? this.generatePseudoId(identifier)
        : "anonymous",
      userType: this.determineUserType(userInfo.email),
      installerPseudoId: this.getInstallerPseudoId(),
    };
  }
}
