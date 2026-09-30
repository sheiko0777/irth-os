import { relations } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, index, uuid, integer } from "drizzle-orm/pg-core";
import { organizations } from "../schema";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  // Durable "which org was I last acting in" — read/written directly by this
  // app's own Drizzle queries (packages/db/src/orgContext.ts), never through
  // Better Auth's own API. Deliberately NOT on `session`: Better Auth issues a
  // brand-new session row on every login with nothing carrying state forward,
  // so a session-scoped choice would force re-picking an org on every fresh
  // login for no benefit. See migration 0043.
  lastActiveOrgId: uuid("last_active_org_id").references(() => organizations.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  // Better Auth `username` plugin (0075): sign-in name for accounts the owner
  // creates directly — usually a mobile number. Stored normalised; unique.
  username: text("username").unique("user_username_uq"),
  displayUsername: text("display_username"),
});

/**
 * Backs the Better Auth `twoFactor` plugin. The plugin owns the fields
 * (secret, backupCodes, verified); this schema just declares them so
 * drizzleAdapter can read/write them. Better Auth manages lifecycle —
 * rows are created on enable, deleted on disable. No org_id: 2FA is a
 * property of the identity, not of any tenant membership.
 */
export const twoFactor = pgTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").default(true).notNull(),
    // Brute-force lockout on TOTP verification, added by better-auth 1.7.4's
    // twoFactor plugin (not present in 1.6.11, which is what this table was
    // originally modeled on) — see migration 0066 for how this was found.
    failedVerificationCount: integer("failed_verification_count").default(0).notNull(),
    lockedUntil: timestamp("locked_until"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("two_factor_user_id_idx").on(table.userId)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  twoFactors: many(twoFactor),
}));

/**
 * Missing entirely until now — the actual cause of the 2FA production
 * incident (see the emergency revert commit). better-auth 1.7.4's
 * drizzle-adapter validates the schema (including relations) at
 * `betterAuth()` construction time; `twoFactor` had a `userId` FK with no
 * matching relations() declaration, unlike every sibling table
 * (session/account both have one, and userRelations names both back).
 * That validation throws synchronously inside createAuth()/buildAuth(),
 * which is why EVERY request touching the lazy `auth` Proxy 500'd, not
 * just 2FA-specific ones.
 */
export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, {
    fields: [twoFactor.userId],
    references: [user.id],
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
