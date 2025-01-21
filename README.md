# passcryptum

## 1. Install nginx

```bash
sudo apt install nginx -y
sudo systemctl start nginx
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
sudo vim /etc/nginx/sites-enabled/default
```

## 2. Set config /etc/nginx/sites-enabled/default

```bash
sudo vim /etc/nginx/sites-enabled/default
```

```text
server {
    
  listen 443 ssl;
  server_name 193.233.20.79 passcryptum.ddns.net;
  
  ssl_certificate /etc/letsencrypt/live/passcryptum.ddns.net/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/passcryptum.ddns.net/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
  
  location /api/userservices/ {
      proxy_pass http://127.0.0.1:8000;
  }

}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 2.Install docker-compose

```bash
sudo apt update
sudo apt install curl
curl -fSL https://get.docker.com -o get-docker.sh
sudo sh ./get-docker.sh
sudo apt install docker-compose-plugin
```

## 3. Create or copy docker compose.production.yml and .env to server

```text
.env example:

DB_HOST=db
DB_PORT=5432
POSTGRES_DB=django
POSTGRES_USER=django
POSTGRES_PASSWORD=pass_example
SECRET_KEY=key_example
```

## 4. Start docker compose and check status

```bash
sudo docker compose -f docker-compose.production.yml up -d
sudo docker compose -f docker-compose.production.yml ps
```

## 5. Make migrations

```bash
sudo docker compose -f docker-compose.production.yml exec backend python manage.py migrate
sudo docker compose -f docker-compose.production.yml exec backend python manage.py collectstatic
sudo docker compose -f docker-compose.production.yml exec backend cp -r /app/collected_static/. /backend_static/static/
```

## 6. 

```bash
sudo docker compose -f docker-compose.production.yml exec backend python manage.py add_public_key <your_public_key>
sudo docker compose -f docker-compose.production.yml exec backend python manage.py delete_public_key <your_public_key>
```

## 7. Additional commands

```bash
sudo docker compose -f docker-compose.production.yml pull
sudo docker compose -f docker-compose.production.yml stop
sudo docker compose -f docker-compose.production.yml down
sudo docker compose -f docker-compose.production.yml logs
```


```bash
docker buildx build --platform=linux/amd64 -t mvlbulankin/passcryptum_backend .
docker buildx build --platform=linux/amd64 -t mvlbulankin/passcryptum_gateway .
```

```bash
docker push mvlbulankin/passcryptum_backend
docker push mvlbulankin/passcryptum_gateway
```
