# Email Groups Feature — Design Document

> **Created:** 2025-05-15
> **Updated:** 2025-05-17
> **Status:** In progress — core feature implemented, pending items listed below

---

## 1. Overview

Platform admins, club admins, facility users, and coaches (all non-student roles, i.e. `staffProcedure`) can create named, reusable email groups scoped to a facility. Groups are populated by applying filters (user tags, age range) to facility members, with manual add/remove overrides. Staff members can compose rich-text emails via Tiptap, preview them, send a test to themselves, and then broadcast to the group via Resend.

---

## 2. Core Concepts

### Email Group
- Named, saved, reusable
- Scoped to a single facility
- Has a **creator** (group admin) who manages filters, membership, and deletion
- Stores filter configuration (tag IDs + age range)
- Membership formula: `(filter matches + manual inclusions) - manual exclusions - users who left`

### Access Control
- All email group and email send endpoints use `staffProcedure` (Facility, Coach, Club Admin, Platform Admin)
- Regular students/users have no access to email groups
- Sidebar nav item "Email Groups" only visible to staff roles

### Group Visibility
| Role | Access |
|------|--------|
| Staff group members | See only groups they belong to ("My Groups") |
| Platform / Club admins | See ALL groups at a facility |
| Non-members / Students | Cannot discover or see the group |

### Group Admin (Creator)
- Manages filters, manual add/remove, group deletion
- Does NOT have exclusive send rights — any staff member in the group can send

---

## 3. Membership Rules

- **Dynamic filters** stay linked to the group — saving filters auto-syncs members (full replace of filter-sourced members)
- **Manual inclusions** — explicitly added users (even if they don't match filters); preserved across filter syncs
- **Manual exclusions** — explicitly removed users (even if they match filters)
- **Leave** — any member can self-remove (opt-out); stored as exclusion with reason `"left"`
- **Rejoin** — a user who left can rejoin (exclusion record removed)
- **Re-sync action** — group admin triggers manual refresh; also happens automatically on filter save
- **Sync behavior** — deletes all `source="filter"` members, then re-adds current filter matches (excluding excluded users)

---

## 4. Email Composition & Sending

### Composition
- **Subject line** — free text (max 500 chars)
- **Body** — Tiptap rich-text editor (bold, italic, links, lists, headings, blockquotes)
- **Attachments** — URL-based attachment field (v1, JPEG upload not yet wired)
- **From address** — `"FirstName LastName <RESEND_FROM_EMAIL>"` (Resend verified domain)
- **Reply-to** — sender's own email address

### Preview & Send Flow
1. Compose in Tiptap editor with toolbar
2. Toggle between Edit and Preview mode (rendered HTML)
3. "Send test email to me" — delivers to sender's own address with `[TEST]` prefix
4. "Send to group" — batch dispatch to all active group members

### Delivery
- **Provider:** Resend (requires `RESEND_API_KEY` and `RESEND_FROM_EMAIL` env vars)
- **Env vars:** Optional at build time (runtime guard throws clear error if missing when sending)
- **Batch sends:** Resend batch API, batches of 50 recipients per call
- **No open/click tracking** (v1)
- **No unsubscribe link** (v1)
- **No rate limits** enforced in-app (rely on Resend plan limits)

---

## 5. Send History

- Every send is logged: sender, group, subject, body HTML, attachments, recipient count, timestamp
- Per-recipient record: userId, email snapshot, delivery status (`sent` | `failed`)
- Viewable in the group detail UI (last 50 sends, ordered by most recent)

---

## 6. Schema Additions

> **Status:** ✅ All models created in Prisma schema and migration applied.

### 6.1 Migration: Add `dateOfBirth` to User

```prisma
// On User model — promote from StudentProfile.profileData JSON blob
dateOfBirth DateTime?
```

> **Note:** Backfill script NOT yet run. Age filter currently falls back to reading `StudentProfile.profileData.dateOfBirth` (JSON blob) at runtime when `User.dateOfBirth` is null.

### 6.2 New Models

✅ All 5 models implemented exactly as designed:
- `EmailGroup`
- `EmailGroupMember`
- `EmailGroupExclusion`
- `EmailSendLog`
- `EmailSendRecipient`

### 6.3 Relation Additions to Existing Models

✅ All relations added to `User`, `Club`, and `ClubFacility` models.

---

## 7. API Routes (tRPC)

> **Status:** ✅ All designed endpoints implemented. Both routers use `staffProcedure`.

### `emailGroups` router

| Procedure | Type | Status | Description |
|-----------|------|--------|-------------|
| `create` | mutation | ✅ | Create group with name, facility, filters; run initial sync |
| `update` | mutation | ✅ | Edit name, filters; **auto-syncs members** on filter change |
| `delete` | mutation | ✅ | Delete group (creator or platform/club admin only) |
| `getMyGroups` | query | ✅ | Groups current user belongs to |
| `getAllForFacility` | query | ✅ | All groups at facility (platform/club admin only) |
| `getById` | query | ✅ | Group detail with member list, exclusions, facility |
| `syncMembers` | mutation | ✅ | Full replace of filter-sourced members; respects exclusions |
| `addMembers` | mutation | ✅ | Manually add users (source = "manual") |
| `removeMembers` | mutation | ✅ | Admin removes users (adds to exclusions with reason "removed") |
| `leave` | mutation | ✅ | Self-removal (adds exclusion with reason "left") |
| `rejoin` | mutation | ✅ | Remove own exclusion record, re-add as manual member |
| `getFilterPreview` | query | ✅ | Given filter params, return count + list of matched users |
| `getSendHistory` | query | ✅ | Send history for a group (last 50 sends) |

### `emailSend` router

| Procedure | Type | Status | Description |
|-----------|------|--------|-------------|
| `sendTest` | mutation | ✅ | Send composed email to sender's own address |
| `sendToGroup` | mutation | ✅ | Batch send to all active members; log to EmailSendLog |

---

## 8. UI Pages

> **Status:** ✅ All core pages implemented.

| Page | Route | Status | Description |
|------|-------|--------|-------------|
| My Groups / All Groups | `/email-groups` | ✅ | Combined list — staff sees own groups, admins see all at facility |
| Create Group | `/email-groups/new` | ✅ | Name, tag/age filters, live preview of matched users |
| Group Detail | `/email-groups/[id]` | ✅ | Editable filters, live preview, member list, sync, add members modal, leave/delete, send history |
| Compose Email | `/email-groups/[id]/compose` | ✅ | Tiptap editor, subject, edit/preview toggle, send test, send to group |

### UI Features Implemented
- **Sidebar nav:** "Email Groups" item with Mail icon, visible to staff roles only
- **Filter editing:** Inline edit on group detail page with tag toggle pills + age range inputs
- **Live preview:** Members list shows real-time filter preview while editing (via `getFilterPreview`)
- **Add Members modal:** Inline dialog (Radix Dialog) on group detail page — search club users by name/email via `user.listClubUsers`, multi-select with checkmarks, existing members auto-excluded from results, submit calls `emailGroups.addMembers`; modal closes and member list refreshes on success
- **Auto-sync on save:** Saving filters triggers backend member sync; group data refreshes automatically
- **Tiptap editor:** Rich text with toolbar (bold, italic, headings, lists, links, blockquotes)
- **Tiptap CSS:** Custom styles added to `globals.css` for editor content rendering

---

## 9. Tech Dependencies

| Package | Purpose | Status |
|---------|---------|--------|
| `@tiptap/react` + extensions | Rich-text editor | ✅ Integrated |
| `resend` | Email API SDK | ✅ Integrated (env vars optional at build) |
| `@react-email/components` | Branded email template wrapper | ⏳ Not yet used |

---

## 10. Implementation Progress

| Phase | Work | Status |
|-------|------|--------|
| **1** | Migration: add `dateOfBirth` to User | ✅ Column added; ⏳ backfill script not yet run |
| **2** | Prisma models for EmailGroup, members, exclusions, send logs | ✅ Done |
| **3** | tRPC routers: CRUD groups, filter/sync, leave/rejoin | ✅ Done |
| **4** | UI: group list + create/edit group + interactive filters | ✅ Done |
| **5** | Tiptap editor integration | ✅ Done; ⏳ JPEG upload not wired |
| **6** | Resend integration: test send + batch send | ✅ Done |
| **7** | Email preview component | ✅ Done (edit/preview toggle in compose page) |
| **8** | Send history log + UI | ✅ Done |

---

## 11. Implementation Decisions & Deviations from Original Design

1. **Access control:** Changed from `protectedProcedure` to `staffProcedure` — only non-student roles can access email groups.
2. **Auto-sync on filter save:** The `update` mutation auto-syncs members when filters change, rather than requiring a manual "Sync Members" click.
3. **Full sync replace:** `syncMembers` now deletes all `source="filter"` members first, then re-adds current matches. This ensures stale filter members are removed.
4. **Age filter fallback:** Since `User.dateOfBirth` is not yet backfilled, the age filter reads from `StudentProfile.profileData.dateOfBirth` (JSON blob) as a runtime fallback.
5. **Admin route consolidated:** No separate `/admin/email-groups` route. The main `/email-groups` page shows "My Groups" for staff and "All Facility Groups" for admins.
6. **Env vars optional:** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are optional at build/startup. Runtime guards throw clear errors when email sending is attempted without them.
7. **Docker compose:** Resend env vars added to `docker-compose.yml` with empty defaults.

---

## 12. Pending / Known Issues

1. **`dateOfBirth` backfill** — Age filter returns 0 results because no users have DOB set. Need to either:
   - Run a backfill script from `StudentProfile.profileData` → `User.dateOfBirth`, OR
   - Have admins manually enter DOB via the admin UI
2. **`@ts-nocheck`** — Both `emailGroups.ts` and `emailSend.ts` have `@ts-nocheck` at the top. Must run `prisma generate` on the deployed environment to get proper types, then remove these.
3. **JPEG attachment upload** — The `attachmentUrls` field exists but no file upload UI is wired yet.
4. **Branded email templates** — `@react-email/components` not yet integrated for styled email wrapper.
5. ~~**Add Members page**~~ — Resolved: replaced dead `/email-groups/[id]/add-members` link with an inline modal dialog on the group detail page.

---

## 13. Deferred to Future Versions

- Open/click tracking (Resend webhooks)
- Unsubscribe links (CAN-SPAM/GDPR compliance)
- Email scheduling (send later)
- Larger attachment types (PDF, etc.)
- Cross-facility combined groups
- Rate limiting / approval flows
- Email templates (saved reusable templates)
- Personalization tokens (`{{firstName}}`, etc.)
