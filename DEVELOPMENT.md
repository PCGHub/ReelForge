# ReelForge Development

## Runtime
- Frontend: Next.js/React
- Backend: AppDeploy router
- Database: AppDeploy DB
- Storage: AppDeploy Storage
- Providers: OpenAI, ElevenLabs, JSON2Video, Runway
- Scheduled cleanup: AppDeploy cron

## Runtime secrets
- OPENAI_API_KEY
- ELEVENLABS_API_KEY
- JSON2VIDEO_API_KEY
- RUNWAY_API_SECRET

Never commit values. `.env.example` contains names only.

## Workflow
1. Forensic audit.
2. Document findings.
3. Define the smallest safe correction.
4. Implement with tests.
5. Run checks.
6. Review diff.
7. Deploy deliberately and verify QA.
