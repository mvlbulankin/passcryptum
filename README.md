# Настройка личного сервера Passcryptum на примере Debian 12

Подключаемся к серверу по ssh:

```bash
ssh root@your_ip
```

Меняем пароль root пользователя:

```bash
sudo passwd root
```

Обновляем сервер и перезагружаемся:

```bash
sudo apt update && sudo apt dist-upgrade -y && sudo reboot
```

Устанавливаем vim:

```bash
sudo apt install vim
```

Т.к. доступ у root по ssh к серверу мы закроем, то надо создать нового пользователя, через которого и будем дальше подключаться. Создаём пользователя следующей командой:

```bash
useradd -m user_name -G sudo -s /bin/bash
```

Правим sudo конфиг:

```bash
visudo
```

Даем возможность пользователям группы sudo использовать sudo без ввода пароля, добавляя NOPASSWD, так как мы не будем устанавливать пароли:

```bash
# Allow members of group sudo to execute any command
%sudo   ALL=(ALL:ALL) NOPASSWD:ALL
```

Запрещаем использовать дополнительные конфиги для безопасности, поэтому удаляем эту строчку:

```bash
#includedir /etc/sudoers.d
```

Запрещаем группе admin использовать sudo, комментируя эту строчку:

```bash
# Members of the admin group may gain root privileges
#%admin ALL=(ALL) ALL
```

Перейти от обычного пользователя к root можно командой:

```bash
su -
```

Заходим под созданным пользователем в его домашнюю директорию для дальнейшей настройки:

```bash
su user_name
cd
```

Ставим маску на все создаваемые файлы, чтобы максимально ограничить доступ к ним:

```bash
echo 'umask 0077' >> .bashrc
```

Создаем папку для хранения ssh ключей и оставляем доступ только пользователю:

```bash
mkdir .ssh && chmod 700 .ssh
```

На локальной машине генерируем пару ssh ключей:

```bash
ssh-keygen -t ed25519
```

Копируем публичный ключ на сервер:

```bash
cat ~/.ssh/id_ed25519.pub | ssh user_name@server_ip -p port_number "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Проверяем подключение к серверу по публичному ключу:

```bash
ssh user_name@server_ip -p port_number
```

Продолжаем на сервере. Заходим в настройки ssh-соединения (всё делаем под root):

```bash
vim /etc/ssh/sshd_config
```

Меняем порт на нестантартный не занятый из диапазона 10001-65535 (посмотреть занятые порты можно командой "ss -lntup"):

```bash
Port 2202
```

Явно запрещаем авторизацию под root, меняя yes на no:

```bash
PermitRootLogin no
```

Запрещаем авторизацию по паролю, оставляя только по ключу:

```bash
PasswordAuthentication no
PermitEmptyPasswords no
```

Ставим принудительную авторизацию по ключу:

```bash
PubkeyAuthentication yes
```

Еще стоит проверить, что в конфиге явно указано:

```bash
KbdInteractiveAuthentication no
или
ChallengeResponseAuthentication no
```

Выходим и сохраняем конфиг, после чего перезапускаем ssh сервер:
```bash
sudo systemctl restart sshd
```

Чтобы каждый раз на локальной машине не прописывать ip адрес, путь до ключа и пользователя, открываем ssh config:

```bash
vi .ssh/config
```

Добавляем следующие строки:

```bash
# Меняем на свой connection_name
Host your_connection_name
  # Меняем на свой ip
  HostName your_ip
  # Меняем на своего пользователя
  User your_login
  IdentitiesOnly yes
  # Меняем на путь к своему IdentityFile
  IdentityFile ~/.ssh/id_ed25519
  # Меняем на свой порт, если не меняли порт, то оставляем 22
  Port 22
```

Теперь мы можем подключаться на сервер с помощью команды:

```bash
ssh your_connection_name
```

Устанавливаем необходимые пакеты на сервере:

```bash
sudo apt install git ufw nmap net-tools curl
```

```bash
ufw - надстройка над iptables, упрощает настройку файрволла сервера.
git - часто необходим для скачивания и развертывания программ на сервере, лишним не будет.
nmap - для простукивания портов, помогает проверить что на сервере лишние порты не открыты.
net-tools - сюда входит популярный ifconfig и netstat, часто облегчает работу.
curl - для выполнения http запросов прямо из консоли.
```

Устанавливаем докер https://docs.docker.com/engine/install/debian/

```bash
sudo apt-get update
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
```

```bash
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Проверяем работу докера:

```bash
sudo docker run hello-world
```

Настраиваем файервол. Разрешаем запросы по протоколам HTTP, HTTPS и SSH:

```bash
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
```

Включаеим файервол:

```bash
sudo ufw enable
```

Проверяем внесённые изменения:

```bash
sudo ufw status
```

Устанавливаем nginx:

```bash
sudo apt install nginx -y 
```

Запускаем nginx:

```bash
sudo systemctl start nginx
```

Открываем в браузере IP-адрес своего сервера без указания порта, nginx должен запуститься на 80 порту. 

Получаем доменное имя, например через https://www.noip.com

Устанавливаем certbot:

```bash
sudo apt install snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

Получаем сертификат:

```bash
sudo certbot --nginx
```

Открываем настройки nginx:

```bash
sudo vim /etc/nginx/sites-enabled/default
```

Редактируем настройки nginx:

```bash
server {
    listen 80;
    server_name <your-ip> <your-domen>;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name <your-ip> <your-domen>;

    ssl_certificate /etc/letsencrypt/live/<your-domen>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<your-domen>/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

Перезапускаем nginx:

```bash
sudo systemctl reload nginx
```

Проверяем валидность nginx конфига:

```bash
sudo nginx -t
```

Проверяем логи nginx:

```bash
sudo tail -f /var/log/nginx/error.log
```

Создаем .env:

```bash
DB_HOST=db
DB_PORT=5432
POSTGRES_DB=db_example
POSTGRES_USER=user_example
POSTGRES_PASSWORD=pass_example
DJANGO_SECRET_KEY=key_example
```

Создаем docker-compose-production.yml:

```yml
volumes:
  pg_data_production:
  static_volume:

services:

  db:
    image: postgres:17.2-alpine
    env_file: .env
    volumes:
      - pg_data_production:/var/lib/postgresql/data
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  backend:
    image: mvlbulankin/passcryptum_backend
    env_file: .env
    volumes:
      - static_volume:/backend_static
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  frontend:
    image: mvlbulankin/passcryptum_frontend
    env_file: .env
    command: cp -r /app/dist/. /frontend_static/
    volumes:
      - static_volume:/frontend_static
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  gateway:
    image: mvlbulankin/passcryptum_gateway
    env_file: .env
    volumes:
      - static_volume:/staticfiles/
    ports:
      - 8000:80
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

Поднимаем контейнеры:

```bash
sudo docker compose -f docker-compose-production.yml up -d
```

Проверяем работу контейнеров:

```bash
sudo docker compose -f docker-compose-production.yml ps
```

Выполняем миграции и собираем статику:

```bash
sudo docker compose -f docker-compose-production.yml exec backend python manage.py migrate
sudo docker compose -f docker-compose-production.yml exec backend python manage.py collectstatic
sudo docker compose -f docker-compose-production.yml exec backend cp -r /app/collected_static/. /backend_static/static/
```

Добавляем/удаляем публичный ключ:

```bash
sudo docker compose -f docker-compose-production.yml exec backend python manage.py add_public_key <your_public_key>
sudo docker compose -f docker-compose-production.yml exec backend python manage.py delete_public_key <your_public_key>
```

Дополнительные команды:

```bash
sudo docker compose -f docker-compose-production.yml pull
sudo docker compose -f docker-compose-production.yml stop
sudo docker compose -f docker-compose-production.yml down
sudo docker compose -f docker-compose-production.yml logs
```


```bash
docker buildx build --platform=linux/amd64 -t mvlbulankin/passcryptum_backend .
docker buildx build --platform=linux/amd64 -t mvlbulankin/passcryptum_frontend .
docker buildx build --platform=linux/amd64 -t mvlbulankin/passcryptum_gateway .
```

```bash
docker push mvlbulankin/passcryptum_backend
docker push mvlbulankin/passcryptum_frontend
docker push mvlbulankin/passcryptum_gateway
```

```bash
docker images
docker rmi $(docker images -f "dangling=true" -q)
docker logs root-backend-1
```
