# Viper Royale backend API

The backend is intentionally stateless between browser profiles. Each WebSocket connection creates its own local demo arena.

## Health check

```bash
curl http://localhost:8765/local/stats
```

## Deployment

Run behind Nginx or another reverse proxy with WebSocket upgrade enabled. Do not commit production settings, uploaded assets, SSH keys, passwords, or `.env` files.
