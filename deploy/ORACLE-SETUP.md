# Putting QuickSign online with Oracle Cloud (Always Free)

You end up with QuickSign running 24/7 at an address like `https://141-147-12-34.sslip.io`,
with HTTPS, document conversion and lasting storage. Cost: nothing, as long as you stay
within the Always Free limits.

## 1. Create the Oracle account
1. Sign up at <https://www.oracle.com/cloud/free/>.
2. **Home region:** pick the one closest to you. It can't be changed later, and the free server only runs there.
3. A card is needed to verify your identity. Always Free resources are not charged.

## 2. Create the server
1. In the Oracle console: **Compute → Instances → Create instance**.
2. **Image:** Canonical Ubuntu 24.04.
3. **Shape:** Ampere → `VM.Standard.A1.Flex`, **2 OCPUs and 12 GB memory**. It must show "Always Free-eligible".
4. **Networking:** create a new virtual cloud network with a public subnet and **assign a public IPv4 address**.
5. **SSH keys:** choose "Generate a key pair for me" and **download the private key**. You need it to log in.
6. Click **Create** and note the **Public IP address** once it is running.

If you get "Out of capacity", try again later or pick another availability domain. This is common for free servers.

## 3. Open the web ports
**Networking → Virtual cloud networks →** your network **→ Security → Default Security List → Add Ingress Rules**:
- Source CIDR: `0.0.0.0/0`
- IP protocol: TCP
- Destination port range: `80,443`

## 4. Upload and start QuickSign
On your computer, in the project folder (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\package.ps1
scp -i "C:\path\to\ssh-key.key" quicksign.tar.gz ubuntu@YOUR_IP:~
ssh -i "C:\path\to\ssh-key.key" ubuntu@YOUR_IP
```

If SSH says the key file's permissions are too open, run this once and try again:

```powershell
icacls "C:\path\to\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"
```

Then, on the server:

```bash
mkdir -p quicksign && tar -xzf quicksign.tar.gz -C quicksign && cd quicksign
bash deploy/setup-oracle.sh
```

The first build takes 5–15 minutes. The script prints your address at the end.

## 5. Settings: email and AI
On the server, edit the settings and restart:

```bash
cd ~/quicksign
nano .env                 # fill in SMTP_* (and GEMINI_API_KEY if you have one); Ctrl+O, Enter, Ctrl+X to save
sudo docker compose up -d
```

Don't change `APP_URL` or `SITE_ADDRESS`. The setup script filled them in.

## 6. First login
The built-in development login does not exist on the live server. Open the site and use
**Create Account**. Anyone who has the address can also create an account.

## Updating after changes
Repeat step 4: package, upload, then on the server:

```bash
tar -xzf quicksign.tar.gz -C quicksign && cd quicksign && bash deploy/setup-oracle.sh
```

Your users, documents and contacts are kept in `~/quicksign/data` and are not touched by updates.

## Useful commands (on the server)
- See the logs: `sudo docker compose logs -f app`
- Restart: `sudo docker compose restart`
- Back up the database and files (the app stops for a moment, so the copy is consistent): `sudo docker compose stop app && tar -czf ~/quicksign-backup.tar.gz -C ~/quicksign data; sudo docker compose start app`

## Good to know
- Oracle may reclaim Always Free servers that sit almost idle for 7 days. Upgrading the account to
  "Pay As You Go" stops that, and you are still not charged while you stay within the free limits.
- The 4 OCPU / 24 GB free allowance is shared across all your A1 servers. 2 OCPU / 12 GB leaves room
  for a second server.
