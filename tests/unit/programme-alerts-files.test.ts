import { describe, expect, it } from "vitest";
import { isProgrammeIconKey, resolveProgrammeIcon } from "@/domain/programme-icons";
import { selectNewRequestRecipients, type AlertCandidate } from "@/domain/concierge";
import { storedImageUrl } from "@/lib/files";
import { STAFF_ROLE_VALUES, staffSchema } from "@/validators/admin";

describe("programme icons", () => {
  const icon = (title: string, category = "OTHER", explicit?: string | null) => resolveProgrammeIcon({ title, category, icon: explicit });

  it("matches the topic of the seeded programme", () => {
    expect(icon("Yacht lunch", "FOOD")).toBe("yacht");
    expect(icon("Race day brunch", "FOOD")).toBe("dining");
    expect(icon("Abu Dhabi Grand Prix", "RACING")).toBe("race");
    expect(icon("Track activity — practice", "RACING")).toBe("track");
    expect(icon("Sunset drinks", "HOSPITALITY")).toBe("champagne");
    expect(icon("DJ & entertainment", "ENTERTAINMENT")).toBe("music");
    expect(icon("Podium celebration", "HOSPITALITY")).toBe("trophy");
    expect(icon("After-race celebration", "AFTER_PARTY")).toBe("party");
    expect(icon("Guest arrival", "ARRIVAL")).toBe("arrival");
  });

  it("matches whole words only and falls back to the category", () => {
    expect(icon("Embarkation", "NETWORKING")).toBe("networking"); // "bar" inside a word is ignored
    expect(icon("Something new", "FOOD")).toBe("dining");
    expect(icon("Something new", "UNKNOWN")).toBe("star");
  });

  it("an explicit admin choice wins; unknown keys are ignored", () => {
    expect(icon("Dinner", "FOOD", "gift")).toBe("gift");
    expect(icon("Dinner", "FOOD", "toString")).toBe("dining");
    expect(isProgrammeIconKey("constructor")).toBe(false);
  });
});

describe("concierge alert routing", () => {
  const person = (id: string, role: AlertCandidate["role"], cats: AlertCandidate["conciergeCategories"] = [], status = "ACTIVE"): AlertCandidate => ({ id, role, status, conciergeCategories: cats });

  it("alerts the staff responsible for the category plus concierge generalists", () => {
    const staff = [person("generalist", "CONCIERGE"), person("transport", "CONCIERGE", ["TRANSPORT"]), person("dining", "CONCIERGE", ["DINING"]), person("admin", "ADMIN"), person("door", "CHECK_IN_STAFF", ["TRANSPORT"])];
    expect(selectNewRequestRecipients(staff, "TRANSPORT").map((p) => p.id).sort()).toEqual(["generalist", "transport"]);
    expect(selectNewRequestRecipients(staff, "DINING").map((p) => p.id).sort()).toEqual(["dining", "generalist"]);
  });

  it("admins with a category are included; others are not unless nobody covers it", () => {
    const staff = [person("yacht-admin", "ADMIN", ["YACHT"]), person("dining", "CONCIERGE", ["DINING"]), person("super", "SUPER_ADMIN")];
    expect(selectNewRequestRecipients(staff, "YACHT").map((p) => p.id)).toEqual(["yacht-admin"]);
    // Nobody covers HOTEL → escalate to admins.
    expect(selectNewRequestRecipients(staff, "HOTEL").map((p) => p.id).sort()).toEqual(["super", "yacht-admin"]);
  });

  it("never alerts disabled staff or check-in staff", () => {
    const staff = [person("off", "CONCIERGE", [], "DISABLED"), person("door", "CHECK_IN_STAFF")];
    expect(selectNewRequestRecipients(staff, "OTHER")).toEqual([]);
  });
});

describe("uploaded images", () => {
  it("serves storage keys through the authorised file route and refuses external URLs", () => {
    expect(storedImageUrl("event_image/AbC_12-x.png")).toBe("/api/files/event_image/AbC_12-x.png");
    expect(storedImageUrl("/brand/web/CJ300_Logo_blk.png")).toBe("/brand/web/CJ300_Logo_blk.png");
    expect(storedImageUrl("https://example.com/x.jpg")).toBeNull();
    expect(storedImageUrl("//evil.example/x.jpg")).toBeNull();
    expect(storedImageUrl("event_image/../../etc/passwd")).toBeNull();
    expect(storedImageUrl(null)).toBeNull();
  });
});

describe("staff roles offered in the admin", () => {
  it("are only super admin and sales viewer", () => {
    expect([...STAFF_ROLE_VALUES].sort()).toEqual(["SALES_VIEWER", "SUPER_ADMIN"]);
    const base = { name: "Sam Staff", email: "sam@joia.test" };
    expect(staffSchema.safeParse({ ...base, role: "SALES_VIEWER" }).success).toBe(true);
    expect(staffSchema.safeParse({ ...base, role: "CONCIERGE" }).success).toBe(false);
  });
});
