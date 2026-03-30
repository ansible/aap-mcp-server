import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PseudoIdentityService } from "./pseudo-identity.js";

describe("PseudoIdentityService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("constructor", () => {
    it("should use TELEMETRY_HMAC_KEY env var", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-hmac-key-from-env";
      const service = new PseudoIdentityService();
      expect(service.isEnabled()).toBe(true);
      const id = service.generatePseudoId("test-input");
      expect(id).toHaveLength(64);
    });

    it("should log warning and be disabled when TELEMETRY_HMAC_KEY is not set", () => {
      delete process.env.TELEMETRY_HMAC_KEY;
      const service = new PseudoIdentityService();
      expect(service.isEnabled()).toBe(false);
    });

    it("should log warning and be disabled when TELEMETRY_HMAC_KEY is empty", () => {
      process.env.TELEMETRY_HMAC_KEY = "";
      const service = new PseudoIdentityService();
      expect(service.isEnabled()).toBe(false);
    });

    it("should log warning and be disabled when TELEMETRY_HMAC_KEY is whitespace only", () => {
      process.env.TELEMETRY_HMAC_KEY = "   ";
      const service = new PseudoIdentityService();
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe("generatePseudoId", () => {
    let service: PseudoIdentityService;

    beforeEach(() => {
      process.env.TELEMETRY_HMAC_KEY = "test-key-for-pseudo-id";
      service = new PseudoIdentityService();
    });

    it("should return consistent hex string for same input", () => {
      const id1 = service.generatePseudoId("ansible-id-123");
      const id2 = service.generatePseudoId("ansible-id-123");
      expect(id1).toBe(id2);
    });

    it("should return different hex for different input", () => {
      const id1 = service.generatePseudoId("ansible-id-123");
      const id2 = service.generatePseudoId("ansible-id-456");
      expect(id1).not.toBe(id2);
    });

    it("should return a 64-character hex string (SHA-256)", () => {
      const id = service.generatePseudoId("test-input");
      expect(id).toHaveLength(64);
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce different output with different keys", () => {
      process.env.TELEMETRY_HMAC_KEY = "key-one";
      const service1 = new PseudoIdentityService();
      const id1 = service1.generatePseudoId("same-input");

      process.env.TELEMETRY_HMAC_KEY = "key-two";
      const service2 = new PseudoIdentityService();
      const id2 = service2.generatePseudoId("same-input");

      expect(id1).not.toBe(id2);
    });

    it("should return 'anonymous' when salt key is not loaded", () => {
      delete process.env.TELEMETRY_HMAC_KEY;
      const disabledService = new PseudoIdentityService();
      expect(disabledService.generatePseudoId("any-input")).toBe("anonymous");
    });
  });

  describe("determineUserType", () => {
    let service: PseudoIdentityService;

    beforeEach(() => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      process.env.INTERNAL_EMAIL_DOMAINS = "redhat.com,ibm.com,ansible.com";
      service = new PseudoIdentityService();
    });

    it("should return 'internal' for configured internal domains", () => {
      expect(service.determineUserType("user@redhat.com")).toBe("internal");
      expect(service.determineUserType("user@ibm.com")).toBe("internal");
      expect(service.determineUserType("user@ansible.com")).toBe("internal");
    });

    it("should return 'external' for non-internal domains", () => {
      expect(service.determineUserType("user@gmail.com")).toBe("external");
      expect(service.determineUserType("user@example.com")).toBe("external");
    });

    it("should be case-insensitive", () => {
      expect(service.determineUserType("user@REDHAT.COM")).toBe("internal");
      expect(service.determineUserType("user@RedHat.Com")).toBe("internal");
    });

    it("should return 'external' when email is undefined", () => {
      expect(service.determineUserType(undefined)).toBe("external");
    });

    it("should return 'external' when email is empty", () => {
      expect(service.determineUserType("")).toBe("external");
    });

    it("should return 'external' when email is whitespace only", () => {
      expect(service.determineUserType("   ")).toBe("external");
    });

    it("should return 'external' for email without @ sign", () => {
      expect(service.determineUserType("not-an-email")).toBe("external");
    });

    it("should return 'external' for subdomain of internal domain", () => {
      expect(service.determineUserType("user@mail.redhat.com")).toBe(
        "external",
      );
      expect(service.determineUserType("user@sub.ibm.com")).toBe("external");
    });

    it("should handle INTERNAL_EMAIL_DOMAINS with spaces and empty entries", () => {
      process.env.INTERNAL_EMAIL_DOMAINS = "redhat.com, , ibm.com, ";
      const svc = new PseudoIdentityService();
      expect(svc.determineUserType("user@redhat.com")).toBe("internal");
      expect(svc.determineUserType("user@ibm.com")).toBe("internal");
      expect(svc.determineUserType("user@gmail.com")).toBe("external");
    });

    it("should use custom INTERNAL_EMAIL_DOMAINS when set", () => {
      process.env.INTERNAL_EMAIL_DOMAINS = "custom.org,test.io";
      const customService = new PseudoIdentityService();
      expect(customService.determineUserType("user@custom.org")).toBe(
        "internal",
      );
      expect(customService.determineUserType("user@test.io")).toBe("internal");
      expect(customService.determineUserType("user@redhat.com")).toBe(
        "external",
      );
    });

    it("should return 'external' for all emails when INTERNAL_EMAIL_DOMAINS is not set", () => {
      delete process.env.INTERNAL_EMAIL_DOMAINS;
      const svc = new PseudoIdentityService();
      expect(svc.determineUserType("user@redhat.com")).toBe("external");
      expect(svc.determineUserType("user@ibm.com")).toBe("external");
    });
  });

  describe("deriveIdentity", () => {
    it("should use ansibleId when available", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      process.env.INTERNAL_EMAIL_DOMAINS = "redhat.com";
      const service = new PseudoIdentityService();

      const result = service.deriveIdentity({
        ansibleId: "550e8400-e29b-41d4-a716-446655440000",
        email: "user@redhat.com",
      });

      expect(result).not.toBeNull();
      expect(result!.userPseudoId).toHaveLength(64);
      expect(result!.userType).toBe("internal");

      const fromId = service.generatePseudoId(
        "550e8400-e29b-41d4-a716-446655440000",
      );
      expect(result!.userPseudoId).toBe(fromId);
    });

    it("should return literal 'anonymous' when ansibleId is missing", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      const service = new PseudoIdentityService();

      const result = service.deriveIdentity({});

      expect(result).not.toBeNull();
      expect(result!.userPseudoId).toBe("anonymous");
      expect(result!.userType).toBe("external");
    });

    it("should return defaults when salt key is not loaded", () => {
      delete process.env.TELEMETRY_HMAC_KEY;
      process.env.INTERNAL_EMAIL_DOMAINS = "redhat.com";
      const service = new PseudoIdentityService();

      const result = service.deriveIdentity({
        ansibleId: "some-id",
        email: "user@redhat.com",
      });

      expect(result.userPseudoId).toBe("anonymous");
      expect(result.userType).toBe("internal");
      expect(result.installerPseudoId).toBe("unknown");
    });

    it("should set userType to external when email is absent", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      const service = new PseudoIdentityService();

      const result = service.deriveIdentity({ ansibleId: "some-id" });
      expect(result!.userType).toBe("external");
    });

    it("should set userType to internal when email matches internal domain", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      process.env.INTERNAL_EMAIL_DOMAINS = "redhat.com";
      const service = new PseudoIdentityService();

      const result = service.deriveIdentity({
        ansibleId: "some-id",
        email: "user@redhat.com",
      });
      expect(result!.userType).toBe("internal");
    });

    it("should include installerPseudoId when INSTALLER_ID is set", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      process.env.INSTALLER_ID = "install-uuid-123";
      const service = new PseudoIdentityService();

      const result = service.deriveIdentity({ ansibleId: "some-id" });
      expect(result).not.toBeNull();
      expect(result!.installerPseudoId).toBeDefined();
      expect(result!.installerPseudoId).toHaveLength(64);
    });

    it("should set installerPseudoId to 'unknown' when INSTALLER_ID is not set", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      delete process.env.INSTALLER_ID;
      const service = new PseudoIdentityService();

      const result = service.deriveIdentity({ ansibleId: "some-id" });
      expect(result).not.toBeNull();
      expect(result!.installerPseudoId).toBe("unknown");
    });
  });

  describe("getInstallerPseudoId", () => {
    it("should return HMAC of installer_id when both keys are set", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      process.env.INSTALLER_ID = "install-uuid-123";
      const service = new PseudoIdentityService();

      const id = service.getInstallerPseudoId();
      expect(id).not.toBeNull();
      expect(id).toHaveLength(64);
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should return consistent value for same inputs", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      process.env.INSTALLER_ID = "install-uuid-123";
      const service = new PseudoIdentityService();

      expect(service.getInstallerPseudoId()).toBe(
        service.getInstallerPseudoId(),
      );
    });

    it("should return 'unknown' when INSTALLER_ID is not set", () => {
      process.env.TELEMETRY_HMAC_KEY = "test-key";
      delete process.env.INSTALLER_ID;
      const service = new PseudoIdentityService();

      expect(service.getInstallerPseudoId()).toBe("unknown");
    });

    it("should return 'unknown' when TELEMETRY_HMAC_KEY is not set", () => {
      delete process.env.TELEMETRY_HMAC_KEY;
      process.env.INSTALLER_ID = "install-uuid-123";
      const service = new PseudoIdentityService();

      expect(service.getInstallerPseudoId()).toBe("unknown");
    });
  });
});
