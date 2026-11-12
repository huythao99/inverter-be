#!/usr/bin/env bash
# Kiểm tra bảo mật VPS (CHỈ ĐỌC, không sửa gì, không in mật khẩu / secret).
# Chạy trên server:  sudo bash scripts/server-audit.sh > /tmp/audit.txt 2>&1
# rồi gửi file /tmp/audit.txt để đánh giá. Đường dẫn mặc định theo deploy.sh.
APP_DIR="${APP_DIR:-/var/www/inverter-be}"
SERVICE="${SERVICE:-nestjs}"
sec() { printf '\n===== %s =====\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

sec "Hệ điều hành"
uname -a; cat /etc/os-release 2>/dev/null | grep -E '^(PRETTY_NAME|VERSION)='
uptime
have apt && { echo "Gói cần cập nhật (bảo mật):"; apt list --upgradable 2>/dev/null | grep -ci security; }
systemctl is-enabled unattended-upgrades 2>/dev/null | sed 's/^/unattended-upgrades: /'
[ -f /var/run/reboot-required ] && echo "!! Cần khởi động lại để áp bản vá kernel"

sec "Cổng đang mở (địa chỉ lắng nghe)"
ss -tulpn 2>/dev/null | awk 'NR==1 || /LISTEN|UNCONN/'

sec "Tường lửa"
have ufw && ufw status verbose
have iptables && { echo "iptables INPUT policy:"; iptables -S INPUT 2>/dev/null | head -20; }
have nft && nft list ruleset 2>/dev/null | head -40

sec "SSH"
sshd -T 2>/dev/null | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|maxauthtries|x11forwarding|allowusers|allowgroups) '
systemctl is-active fail2ban 2>/dev/null | sed 's/^/fail2ban: /'
have fail2ban-client && fail2ban-client status 2>/dev/null | head -5
echo "Đăng nhập SSH thất bại 24h qua: $(journalctl -u ssh -u sshd --since '24 hours ago' 2>/dev/null | grep -c 'Failed password\|Invalid user')"
echo "Tài khoản có shell:"; awk -F: '$7 ~ /(bash|sh|zsh)$/ {print "  "$1" uid="$3}' /etc/passwd
echo "Có quyền sudo:"; getent group sudo wheel 2>/dev/null

sec "Tiến trình Node (chạy bằng user nào)"
systemctl show "$SERVICE" -p User -p ExecStart -p Restart 2>/dev/null
ps -eo user,pid,cmd | grep -E 'node|nest' | grep -v grep | head
node -v 2>/dev/null | sed 's/^/node: /'

sec "File secret (quyền truy cập, KHÔNG in nội dung)"
for f in "$APP_DIR"/.env "$APP_DIR"/.env.production "$APP_DIR"/*firebase-adminsdk*.json; do
  [ -e "$f" ] && stat -c '%A %U:%G %n' "$f"
done
if [ -f "$APP_DIR/.env" ]; then
  echo "Biến quan trọng (có / thiếu / còn giá trị mặc định):"
  envget() { grep -E "^$1=" "$APP_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
  for k in CMS_JWT_SECRET CMS_ADMIN_PASSWORD MQTT_ENCRYPTION_KEY MONGODB_PASSWORD REDIS_PASSWORD MQTT_PASSWORD; do
    v="$(envget "$k")"
    if [ -z "$v" ]; then echo "  $k: THIẾU"
    elif [ "$v" = "cms_default_secret_change_in_production" ] || [ "$v" = "admin123" ]; then echo "  $k: !! GIÁ TRỊ MẶC ĐỊNH"
    else echo "  $k: có (độ dài ${#v})"; fi
  done
  for k in HYBRID_EXCLUSIVE_OWNER LOG_LEVELS CMS_CORS_ORIGIN USER_APP_CORS_ORIGIN HTTPS_ENABLED MQTT_URL; do
    echo "  $k=$(envget "$k" | sed -E 's#//[^@/]*@#//***@#')"
  done
fi
[ -d "$APP_DIR/.git" ] && echo "Thư mục .git có trong $APP_DIR (đảm bảo nginx không phục vụ nó)"

sec "nginx"
have nginx && nginx -v 2>&1
nginx -T 2>/dev/null | grep -Ei 'server_name|listen |ssl_protocols|ssl_ciphers|server_tokens|add_header|location |proxy_pass|client_max_body_size|limit_req|root |autoindex' | sed 's/^\s*//' | sort | uniq -c | sort -rn | head -60

sec "Chứng chỉ TLS"
for c in /etc/letsencrypt/live/*/fullchain.pem; do
  [ -f "$c" ] && echo "$c: $(openssl x509 -enddate -noout -in "$c")"
done
systemctl list-timers 2>/dev/null | grep -i certbot

sec "Mosquitto"
for f in /etc/mosquitto/mosquitto.conf /etc/mosquitto/conf.d/*.conf; do
  [ -f "$f" ] && { echo "--- $f"; grep -Ev '^\s*(#|$)' "$f" | grep -Ev 'password|_pass|secret'; }
done

sec "MongoDB"
for f in /etc/mongod.conf; do [ -f "$f" ] && grep -Ev '^\s*(#|$)' "$f" | grep -Ei 'bindIp|port|authorization|security|tls' ; done
docker ps 2>/dev/null | grep -i mongo

sec "Redis"
for f in /etc/redis/redis.conf; do
  [ -f "$f" ] && { grep -Ei '^\s*(bind|protected-mode|port) ' "$f"; grep -Eq '^\s*requirepass ' "$f" && echo "requirepass: có" || echo "requirepass: KHÔNG"; }
done

sec "Sao lưu"
crontab -l 2>/dev/null | grep -Ei 'mongodump|backup' ; ls /etc/cron.d 2>/dev/null; ls -la /var/backups 2>/dev/null | tail -5

sec "Log & dung lượng"
df -h / | tail -1
du -sh /var/log 2>/dev/null
journalctl --disk-usage 2>/dev/null

sec "Phụ thuộc npm (lỗ hổng đã biết)"
[ -d "$APP_DIR" ] && (cd "$APP_DIR" && npm audit --omit=dev 2>/dev/null | tail -4)

echo; echo "Xong. Gửi lại toàn bộ kết quả để đánh giá."
