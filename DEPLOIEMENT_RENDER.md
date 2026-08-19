# Déploiement Render — Application RH

Ce paquet est préparé pour le compte :

`jocelindahin796@gmail.com`

## Étape 1 — Créer le dépôt GitHub

Connecte-toi à GitHub avec le compte souhaité, puis crée un dépôt vide, par exemple :

`rh-control`

## Étape 2 — Pousser le projet

Dans ce dossier, tu peux lancer :

`POUSSER_SUR_GITHUB.bat`

Le script demandera l’URL HTTPS du dépôt GitHub, par exemple :

`https://github.com/COMPTE/rh-control.git`

## Étape 3 — Déployer sur Render

1. Connecte-toi à Render avec `jocelindahin796@gmail.com`.
2. Clique sur `New`.
3. Choisis `Blueprint`.
4. Sélectionne le dépôt GitHub.
5. Render détectera automatiquement `render.yaml`.
6. Lance le déploiement.

## Configuration incluse

- Service web Python.
- Dossier racine Render : `application-rh`.
- Commande de build : `python -m pip install -r requirements.txt`.
- Commande de démarrage : `python server.py`.
- Plan Render gratuit.
- Base SQLite temporaire par défaut : `/tmp/rh_control.sqlite`.
- Compatibilité PostgreSQL externe gratuite via `DATABASE_URL`.

Important : sans base externe, SQLite sur Render gratuit reste temporaire. Pour rester en gratuit tout en gardant les données, il faut brancher une base PostgreSQL gratuite externe.

## Après déploiement

Le projet contient maintenant :

- protection optionnelle par mot de passe ;
- export/import JSON des données RH ;
- sauvegarde serveur ;
- diagnostic visuel pour savoir si la base est durable ou temporaire.

Variables recommandées dans Render :

- `APP_PASSWORD` : mot de passe du rôle `Admin RH` ;
- `ASSISTANT_RH_PASSWORD` : mot de passe du rôle `Assistant RH` ;
- `DIRECTION_PASSWORD` : mot de passe du rôle `Direction` ;
- `APP_SESSION_SECRET` : secret long et aléatoire ;
- `RH_DATABASE_PATH=/tmp/rh_control.sqlite` tant que la base externe n’est pas branchée ;
- `DATABASE_URL=postgresql://...` dès qu’une base PostgreSQL gratuite externe est disponible ;
- variables SMTP optionnelles (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `NOTIFY_RH_EMAIL`, `NOTIFY_DIRECTION_EMAIL`) pour activer l’envoi e-mail réel.

## Solution gratuite pour une base durable

Ne pas utiliser Render Postgres gratuit pour les données importantes, car il expire après 30 jours.

Solution recommandée sans paiement :

1. Garder l’application sur Render gratuit.
2. Créer une base PostgreSQL gratuite externe, par exemple Neon Free.
3. Copier l’URL de connexion PostgreSQL.
4. Ajouter cette URL dans Render avec le nom `DATABASE_URL`.
5. Redéployer.

L’application détecte automatiquement `DATABASE_URL`. Après redéploiement, `/api/health` doit afficher :

- `mode: postgres`
- `durable: true`
