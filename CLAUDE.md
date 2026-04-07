# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |

## Secrets / Credentials / Proxy (OneCLI)

API keys, secret keys, OAuth tokens, and auth credentials are managed by the OneCLI gateway — which handles secret injection into containers at request time, so no keys or tokens are ever passed to containers directly. Run `onecli --help`.

## Skills

Four types of skills exist in NanoClaw. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full taxonomy and guidelines.

- **Feature skills** — merge a `skill/*` branch to add capabilities (e.g. `/add-telegram`, `/add-slack`)
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`)
- **Operational skills** — instruction-only workflows, always on `main` (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/init-onecli` | Install OneCLI Agent Vault and migrate `.env` credentials to it |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Contributing

Before creating a PR, adding a skill, or preparing any contribution, you MUST read [CONTRIBUTING.md](CONTRIBUTING.md). It covers accepted change types, the four skill types and their guidelines, SKILL.md format rules, PR requirements, and the pre-submission checklist (searching for existing PRs/issues, testing, description format).

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.

## Health Check Checklist

Run this checklist after any significant change (restart, config update, state clear, etc.)

### 1. Service & Container Health
- [ ] Service is running: `ssh root@64.227.103.46 'systemctl status nanoclaw'`
- [ ] Container spawned: `ssh root@64.227.103.46 'docker ps --filter "name=nanoclaw"'`
- [ ] No orphaned containers: Check for multiple containers running
- [ ] Logs show "NanoClaw running": `journalctl -u nanoclaw --since "1 minute ago"`

### 2. MCP Configuration
- [ ] Config exists: `ssh root@64.227.103.46 'test -f /home/nanoclaw/nanoclaw/data/sessions/whatsapp_main/.claude/claude_desktop_config.json && echo "✓ Config exists" || echo "✗ MISSING"'`
- [ ] Google Drive MCP configured with correct paths
- [ ] Trello MCP configured with credentials
- [ ] Token files exist:
  - `ls /home/nanoclaw/.config/google-drive-mcp/tokens.json`
  - `ls /home/nanoclaw/.config/google-drive-mcp/gcp-oauth.keys.json`
- [ ] Tokens mounted in container: `docker exec <container> ls /workspace/google-drive-mcp/tokens.json`

### 3. Session State Consistency
- [ ] Session DB matches .claude files:
  - `sqlite3 /home/nanoclaw/nanoclaw/store/messages.db "SELECT * FROM sessions;"`
  - `ls /home/nanoclaw/nanoclaw/data/sessions/whatsapp_main/.claude/sessions/`
- [ ] If mismatch: Clear sessions table or recreate session files

### 4. Message Processing
- [ ] Send test message to Pet
- [ ] Wait 30s, check if container spawns
- [ ] Monitor CPU usage: `docker stats --no-stream <container>`
  - Active processing: 20-70% CPU
  - Stuck: <1% CPU for >2 minutes
- [ ] Check logs for progress: `docker logs --tail 20 <container>`
- [ ] Verify response sent (check WhatsApp or logs)

### 5. Common Failure Patterns
- [ ] **Stuck at message #X with low CPU**: Kill container, check session mismatch
- [ ] **"No conversation found" error**: Session ID in DB doesn't match files - clear sessions table
- [ ] **MCP tools not working**: Check config file exists and has correct paths/credentials
- [ ] **Container immediately exits**: Check logs for API errors or missing mounts

### 6. After State Clearing Operations

If you cleared `/home/nanoclaw/nanoclaw/data/sessions/whatsapp_main/.claude/*`:
- [ ] Recreate `claude_desktop_config.json` with MCP servers
- [ ] Clear sessions table: `sqlite3 /home/nanoclaw/nanoclaw/store/messages.db "DELETE FROM sessions;"`
- [ ] Restart service
- [ ] Run full checklist

### 7. Clear Past Message Attempts

Use when:
- Hit rate limits and want to skip queued retries
- Deployed a bug fix and want to skip old failed messages
- Containers keep spawning for old messages

**Procedure:**
```bash
# 1. Stop service
ssh root@64.227.103.46 'systemctl stop nanoclaw'

# 2. Kill any running containers
ssh root@64.227.103.46 'docker ps --filter "name=nanoclaw" -q | xargs -r docker kill'

# 3. Update message timestamps to skip old messages
ssh root@64.227.103.46 "sqlite3 /home/nanoclaw/nanoclaw/store/messages.db \"UPDATE router_state SET value = '\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)' WHERE key = 'last_timestamp';\""

ssh root@64.227.103.46 "sqlite3 /home/nanoclaw/nanoclaw/store/messages.db \"UPDATE router_state SET value = '{\\\\\\\"16506449188@s.whatsapp.net\\\\\\\":\\\\\\\"\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\\\\\\\"}' WHERE key = 'last_agent_timestamp';\""

# 4. Restart service
ssh root@64.227.103.46 'systemctl start nanoclaw'

# 5. Verify no old messages processing
ssh root@64.227.103.46 'docker ps --filter "name=nanoclaw"'  # Should show no containers
ssh root@64.227.103.46 'journalctl -u nanoclaw --since "1 minute ago"'  # Should be idle
```

**Verification checklist:**
- [ ] No containers running: `docker ps --filter "name=nanoclaw"`
- [ ] Service is active: `systemctl status nanoclaw`
- [ ] Logs show "NanoClaw running" with no container spawns
- [ ] Ready for new messages

### Quick Commands

Status check:
```bash
pet-status
```

Restart:
```bash
pet-restart
```

Clear message queue (skip old attempts):
```bash
pet-clear-queue
```

Monitor logs:
```bash
pet-logs
```

Full health check (one-liner):
```bash
ssh root@64.227.103.46 'systemctl status nanoclaw && docker ps --filter "name=nanoclaw" && test -f /home/nanoclaw/nanoclaw/data/sessions/whatsapp_main/.claude/claude_desktop_config.json && echo "✓ MCP config exists" || echo "✗ MCP config missing"'
```
