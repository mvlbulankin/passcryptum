# Issue #187 — Services on The Server

- Author: nelkor · opened 2024-02-29 · labels: enhancement, help wanted, question, release, research and develop, refactoring · assignee: Artem
- Source: https://github.com/nelkor/passcryptum/issues/187 (local copy; upstream may disappear)
- Status: **implemented in Passcryptum 3.0** (backend + online mode)

## Body

I propose a new feature to manage service configurations directly from the server, with a focus on encryption and user consent. Here's an overview of the concept:

- **User Consent for Server Interaction**: The application should interact with the server strictly under user permission, ensuring that users retain control over their data and its exchange.
- **Encrypted Configuration Storage**: Service configurations should be stored on the server in an encrypted format, accessible to the user for both reading and writing operations.

### Implementation Outline

The process involves generating cryptographic keys from the user's password using the PBKDF2 algorithm. Specifically:

- A private key is derived from the user's password.
- This private key is then used to generate a corresponding public key, which serves as a unique identifier (index) for storing the user's configuration on the server.
- To safeguard each configuration read/write request, we include the current timestamp and an electronic signature. This approach ensures the server can verify the freshness of the request and confirm it originates from the legitimate user, who possesses the correct password.

I welcome any suggestions, enhancements, or concerns regarding this proposal.

## Comments (nelkor)

### 2024-05-14 — Исходная энтропия

Исходная энтропия — это буфер байтов, полученный из секретного знания пользователя (исходный пароль, seed-фраза или что угодно ещё).

Исходная энтропия включает:
- зерно генерации паролей для аккаунтов;
- идентификатор;
- приватный ключ;
- публичный ключ (выводится из приватного);
- синхронный ключ;
- вектор инициализации;

**Зерно генерации паролей для аккаунтов** — может иметь любой размер, чем больше, тем лучше. Применяется для выведения пароля для конкретного аккаунта, наряду со всеми данными этого аккаунта.

**Идентификатор** — небольшой (например, 8 байтов). Применяется для генерации контента (надпись/изображение), по которому пользователь сможет убедиться в правильности исходной энтропии.

**Приватный ключ** — 32 байта. Электронная подпись запросов.

**Публичный ключ** — выводится из приватного, занимает 0 байтов. Используется в качестве ключа для сохранения конфигурации как на сервере, так и в localStorage.

**Синхронный ключ** — 32 байта. Для зашифровывания и расшифровывания конфигурации.

**Вектор инициализации** — 24 байта. Вместе с синхронным ключом по алгоритму Salsa20.

**ИТОГО**: N + 8 + 32 + 32 + 24 = N + 96 байтов; при N = 160 — 256 байтов.

### 2024-05-15 — tweetnacl

Web Crypto API не умеет выводить асимметричные приватные ключи из произвольной энтропии. Лучший вариант — библиотека tweetnacl: мало весит, код нравится. Помимо Ed25519 для подписи в ней есть BLAKE2b и Salsa20, которых нет в Web Crypto API.

### 2024-05-17 — Примеры запросов сервера

**Сохранение конфигурации** — POST. Публичный ключ в заголовке. Тело: 64 байта сигнатуры (Ed25519) ‖ 4 байта timestamp (беззнаковое до 4294967295) ‖ зашифрованная конфигурация. Подписываются timestamp и конфигурация вместе.

**Получение конфигурации** — GET. Заголовки: публичный ключ, timestamp, сигнатура timestamp. Конфиг не отдаём кому попало (он ведь зашифрованный) — чтобы нельзя было следить за изменениями.

### 2024-06-06 — Примеры кода

Хеширование (tweetnacl hash), подпись (sign.detached / verify), шифрование (secretbox с secretBoxIv 24 и secretBoxKey 32).

### 2024-07-31 — Онлайн PIN

Мотивация: хранить исходную энтропию на сервере (под защитой PIN) — так сложнее перебирать PIN, чем при хранении на устройстве. Энтропия на сервере зашифрована; ключ расшифровки хранится на устройстве (localStorage). Для каждого нового устройства — своё хранилище.

Во избежание перебора PIN зашифрованная энтропия сохраняется под уникальным ключом, который также хранится на устройстве — **протектор**. Чтобы воспользоваться онлайн PIN: иметь протектор, знать PIN, иметь ключ расшифровки.

Если забыл PIN — выводишь энтропию из источника (исходный пароль) и устанавливаешь новый онлайн PIN.

**Установка PIN**: передаём публичный ключ, зашифрованную энтропию, значение PIN, метку, сигнатуру; в ответ сервер отправляет протектор.
