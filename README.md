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

  listen 80;
  server_name public_ip_of_your_remote_server;

  location / {
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

POSTGRES_USER=user_example
POSTGRES_PASSWORD=pass_example
POSTGRES_DB=db_example
DB_HOST=host_example
DB_PORT=port_example
SECRET_KEY=key_example
HTTP_HOST=http://example.com
HTTPS_HOST=https://example.com
```

## 4. Start docker compose and check status

```bash
sudo docker compose -f docker-compose.production.yml up -d
sudo docker compose -f docker-compose.production.yml ps
```

## 5. Make migrations and create superuser

```bash
sudo docker compose -f docker-compose.production.yml exec backend python manage.py migrate
sudo docker compose -f docker-compose.production.yml exec backend python manage.py collectstatic
sudo docker compose -f docker-compose.production.yml exec backend cp -r /app/collected_static/. /backend_static/static/
sudo docker compose -f docker-compose.production.yml exec backend python manage.py createsuperuser --email admin@example.com --username admin
```

## 6. Additional commands

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
