# Docker Isolation Guide

This guide covers running Automaker in a fully isolated Docker container. For background on why isolation matters, see the [Security Disclaimer](../DISCLAIMER.md).

## Quick Start

1. **Set your API key** (create a `.env` file in the project root):

   ```bash
   # Linux/Mac
   echo "ANTHROPIC_API_KEY=your-api-key-here" > .env

   # Windows PowerShell
   Set-Content -Path .env -Value "ANTHROPIC_API_KEY=your-api-key-here" -Encoding UTF8
   ```

2. **Build and run**:

   ```bash
   docker-compose up -d
   ```

3. **Access Automaker** at `http://localhost:3007`

4. **Stop**:

   ```bash
   docker-compose down
   ```

## How Isolation Works

The default `docker-compose.yml` configuration:

- Uses only Docker-managed volumes (no host filesystem access)
- Server runs as a non-root user
- Has no privileged access to your system

Projects created in the UI are stored inside the container at `/projects` and persist across restarts via Docker volumes.

## Mounting a Specific Project

If you need to work on a host project, create `docker-compose.project.yml`:

```yaml
services:
  server:
    volumes:
      - ./my-project:/projects/my-project:ro # :ro = read-only
```

Then run:

```bash
docker-compose -f docker-compose.yml -f docker-compose.project.yml up -d
```

**Tip**: Use `:ro` (read-only) when possible for extra safety.

## Troubleshooting

| Problem               | Solution                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Container won't start | Check `.env` has `ANTHROPIC_API_KEY` set. Run `docker-compose logs` for errors.              |
| Can't access web UI   | Verify container is running with `docker ps \| grep automaker`                               |
| Need a fresh start    | Run `docker-compose down && docker volume rm automaker-data && docker-compose up -d --build` |
