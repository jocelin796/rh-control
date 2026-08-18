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
- Base SQLite sur disque persistant : `/var/data/rh_control.sqlite`.
- Disque persistant Render : `1 GB`.

Important : pour conserver les données, le disque persistant Render doit rester activé.

## Après déploiement

Le projet contient maintenant :

- protection optionnelle par mot de passe ;
- export/import JSON des données RH ;
- sauvegarde serveur ;
- diagnostic visuel pour savoir si la base est durable ou temporaire.

Variables recommandées dans Render :

- `APP_PASSWORD` : mot de passe d’accès ;
- `APP_SESSION_SECRET` : secret long et aléatoire ;
- `RH_DATABASE_PATH=/var/data/rh_control.sqlite` quand le disque persistant est activé.

Si le service est encore sur plan gratuit sans disque, utiliser temporairement :

`RH_DATABASE_PATH=/tmp/rh_control.sqlite`
