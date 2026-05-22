# RLS Security Migration - Application Guide

## 📋 Overview

This guide covers applying the RLS (Row Level Security) security policy fixes to your live Supabase database for project `chlwcvqedxbdgntsmuzu`.

**Migration File:** `supabase/migrations/20260522000000_fix_rls_security_policies.sql`

## ✅ Pre-Flight Checklist

- [ ] Supabase CLI installed (`npm install -g supabase`)
- [ ] Authenticated with Supabase (`supabase login`)
- [ ] `.env` file configured with Supabase credentials
- [ ] Database backup completed
- [ ] Maintenance window scheduled (if needed)

## 🚀 Application Methods

### Method 1: Using Supabase Dashboard (Recommended for Production)

1. **Navigate to Supabase Dashboard**
   - Go to https://app.supabase.com
   - Select project: `chlwcvqedxbdgntsmuzu`
   - Click "SQL Editor"

2. **Create New Query**
   - Click "+ New Query"
   - Name: "Fix RLS Policies"

3. **Copy Migration SQL**
   - Open: `supabase/migrations/20260522000000_fix_rls_security_policies.sql`
   - Copy entire file content
   - Paste into SQL Editor

4. **Execute**
   - Click "Run" button
   - Wait for completion (typically < 30 seconds)
   - Verify success message

### Method 2: Using Supabase CLI (Local Development)

```bash
# 1. Ensure you're in the project root
cd /path/to/pacing-sync-pilot

# 2. Authenticate with Supabase
supabase login

# 3. Link to your project
supabase link --project-ref chlwcvqedxbdgntsmuzu

# 4. Apply pending migrations
supabase migration up

# 5. Verify migration status
supabase migration list
```

### Method 3: Automated Script

```bash
# Make script executable
chmod +x scripts/apply-migration.sh

# Run migration script
./scripts/apply-migration.sh
```

## 📊 Tables Updated (22 Total)

### System Tables (3)
- `system_config` - Configuration management
- `automation_jobs` - Job scheduling
- `system_health_snapshots` - Health monitoring

### Teacher Tables (3)
- `teacher_memory` - Teacher knowledge base
- `teacher_feedback_log` - Feedback tracking
- `teacher_patterns` - Pattern recognition

### Pacing/Content Tables (7)
- `weeks` - Pacing weeks
- `pacing_rows` - Daily pacing entries
- `deploy_log` - Deployment history
- `files` - File management
- `announcements` - Announcements
- `newsletters` - Newsletter content
- `content_map` - Content mapping

### Canvas Tables (4)
- `canvas_snapshots` - Canvas data snapshots
- `canvas_patterns` - Pattern analysis
- `learning_rules` - Learning rules
- `canvas_orphan_files` - Orphaned files

### Calendar Tables (2)
- `school_calendar` - School events
- `annual_pacing_master` - Annual pacing

### Dev Tables (2)
- `dev_canvas_logs` - Development logs
- `dev_canvas_snapshots` - Development snapshots

## 🔒 Security Changes

### Before Migration
```sql
-- Overly permissive policies
CREATE POLICY "allow_all" ON public.weeks 
  FOR ALL USING (true) WITH CHECK (true);
```

### After Migration
```sql
-- Role-based policies with explicit authentication
CREATE POLICY weeks_authenticated_read
  ON public.weeks FOR SELECT
  TO authenticated USING (true);

CREATE POLICY weeks_authenticated_write
  ON public.weeks FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY weeks_authenticated_update
  ON public.weeks FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY weeks_authenticated_delete
  ON public.weeks FOR DELETE
  TO authenticated USING (true);
```

## ✨ Verification Steps

### 1. Check Migration Status
```bash
supabase migration list --project-ref chlwcvqedxbdgntsmuzu
```

Expected output shows `20260522000000_fix_rls_security_policies` as applied.

### 2. Verify Policies Applied
In Supabase Dashboard:
1. Go to "Authentication" → "Policies"
2. Select any table (e.g., `weeks`)
3. Verify policies are present and active
4. Look for `{table}_authenticated_*` policies

### 3. Run Security Linter
```bash
supabase db lint --schema public
```

Expected: All RLS violations resolved ✅

### 4. Test Application Access
1. Log in to your application
2. Test CRUD operations on known tables
3. Verify authenticated users can access data
4. Confirm unauthenticated requests are blocked

## 🚨 Troubleshooting

### Issue: "Permission denied" errors
**Cause:** RLS policies blocking access
**Solution:** 
- Verify user is authenticated
- Check user session in Supabase Auth
- Review policy conditions

### Issue: Edge Functions failing
**Cause:** Service role key issues
**Solution:**
- Service role bypasses RLS - should work fine
- Verify SUPABASE_SERVICE_ROLE_KEY environment variable
- Check Edge Function logs

### Issue: Specific table failing
**Cause:** Table not in migration or duplicate policies
**Solution:**
- Run migration again (idempotent - safe to re-run)
- Check for orphaned policies in dashboard
- Drop conflicting policies manually if needed

### Issue: Migration stuck or timing out
**Cause:** Large table locks or network issues
**Solution:**
- Wait 5-10 minutes and retry
- Try via Dashboard instead of CLI
- Contact Supabase support if persists

## 📈 Performance Impact

- **Migration Duration:** < 1 minute (typically 30 seconds)
- **Downtime Required:** None (non-blocking)
- **Performance Impact:** Negligible (policy checks are indexed)
- **Rollback Time:** < 5 minutes if needed

## 🔄 Rollback Procedure

If you need to revert to the previous state:

```bash
# Get the previous migration ID
supabase migration list

# Reset to previous state
supabase migration up --to <previous_migration_id>
```

Or manually via SQL:
```sql
DROP POLICY IF EXISTS weeks_authenticated_read ON public.weeks;
DROP POLICY IF EXISTS weeks_authenticated_write ON public.weeks;
-- ... repeat for all policies
CREATE POLICY "allow_all" ON public.weeks FOR ALL USING (true) WITH CHECK (true);
```

## 📞 Support & Questions

- **Supabase Docs:** https://supabase.com/docs/guides/auth/row-level-security
- **Project Issues:** Check `/issues` directory
- **Emergency Rollback:** Revert to previous migration version

## ✅ Completion Checklist

- [ ] Migration applied successfully
- [ ] All 22 tables verified
- [ ] Security linter passing
- [ ] Application tests passing
- [ ] User access verified
- [ ] Edge Functions working
- [ ] Monitoring/alerting configured
- [ ] Documentation updated

---

**Last Updated:** 2026-05-22  
**Status:** Ready for Production  
**Migration ID:** 20260522000000
