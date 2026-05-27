# Deploy: systemd service

Run these commands once on the VM to register and start the service:

```bash
sudo cp deploy/tanuh-renal-portal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable tanuh-renal-portal
sudo systemctl start tanuh-renal-portal

# Check status
sudo systemctl status tanuh-renal-portal

# View live logs
sudo journalctl -u tanuh-renal-portal -f

# Restart after a git pull
sudo systemctl restart tanuh-renal-portal
```
