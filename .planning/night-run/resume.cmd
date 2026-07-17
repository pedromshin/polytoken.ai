@echo off
REM Night-run resume insurance (2026-07-17 07:50) — fired by Windows Task Scheduler.
REM The heartbeat guard below prevents dual writers: if the original orchestrator
REM session is still alive, the resumed session exits without writing.
cd /d C:\Users\pc\Desktop\nauta.services.email-listener
claude --dangerously-skip-permissions -p "Read .planning/night-run/NIGHT-RUN-2026-07-16.md top to bottom, then check .planning/night-run/HEARTBEAT: if its timestamp is younger than 15 minutes, another orchestrator session is still alive — exit immediately without writing anything. Otherwise: run /gsd:resume-work, then continue the Night Run's 'Run order' from the first unchecked box, honoring LANE-CONTRACTS.md (lane boundaries, migrations queue, single-writer rule, push at green boundaries) and updating HEARTBEAT each turn. The user is traveling and pre-authorized autonomous continuation up to the v2.2 slice; Phase 61's human gate stays open and is never faked." >> .planning\night-run\resume-log.txt 2>&1
