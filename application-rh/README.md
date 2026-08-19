# Application RH — Contrats, congés et alertes

Cette application web est une première version fonctionnelle basée sur le cahier des charges fourni.

## Comment lancer avec la vraie base de données

Double-cliquer sur :

`LANCER_APPLICATION_RH.bat`

Le serveur local démarre automatiquement et ouvre l’application à l’adresse :

`http://127.0.0.1:8750`

La base de données SQLite est créée ici :

`application-rh/database/rh_control.sqlite`

Il faut laisser la fenêtre du serveur ouverte pendant l’utilisation.

L’application ne charge plus de données fictives. Elle affiche uniquement les données réellement présentes dans la base SQLite.

## Mise en ligne sur Render

Les fichiers de déploiement Render sont prêts :

- `render.yaml` à la racine du dossier projet ;
- `requirements.txt` dans `application-rh` ;
- serveur compatible avec le port dynamique Render ;
- mode gratuit Render compatible avec une base temporaire SQLite ;
- mode durable gratuit compatible avec PostgreSQL externe via `DATABASE_URL`.

### Option retenue sans paiement

Pour ne rien payer, il ne faut pas utiliser de disque persistant Render ni Render Postgres gratuit.

La configuration recommandée est :

1. Application hébergée sur Render en plan gratuit.
2. Base PostgreSQL gratuite externe, par exemple Supabase Free ou Neon Free.
3. Variable Render à ajouter :
   - `DATABASE_URL=postgresql://...`

Quand `DATABASE_URL` est présent, l’application utilise automatiquement PostgreSQL et l’indicateur affiche `Base durable active`.

Important : Render Postgres gratuit n’est pas retenu, car cette base expire après 30 jours.

### Option recommandée : Blueprint Render

1. Mettre le dossier du projet sur GitHub.
2. Aller sur Render.
3. Cliquer sur `New` puis `Blueprint`.
4. Sélectionner le dépôt GitHub.
5. Render détectera `render.yaml`.
6. Lancer le déploiement.

### Option manuelle : Web Service

Créer un `Web Service` avec ces paramètres :

- Root Directory : `application-rh`
- Runtime : `Python`
- Build Command : `python -m pip install -r requirements.txt`
- Start Command : `python server.py`
- Environment Variable :
  - `RH_DATABASE_PATH=/tmp/rh_control.sqlite` si aucune base externe n’est encore branchée ;
  - `DATABASE_URL=postgresql://...` dès que la base gratuite externe est créée.

Important : sans `DATABASE_URL`, la base SQLite Render reste temporaire et peut être perdue après redémarrage ou redéploiement.

## Sécurité légère

Le serveur peut protéger l’application par mot de passe avec ces variables Render :

- `APP_PASSWORD` : mot de passe d’accès à l’application ;
- `APP_SESSION_SECRET` : secret utilisé pour signer la session.

Si `APP_PASSWORD` n’est pas défini, l’application reste ouverte.

## Sauvegardes

Dans l’onglet `Paramétrage`, une section `Maintenance base de données` permet :

- d’exporter les données RH en JSON ;
- d’importer un export JSON ;
- de créer une sauvegarde serveur SQLite ou une copie JSON si la base est PostgreSQL.

Sur Render gratuit, les sauvegardes serveur restent temporaires. La sauvegarde la plus sûre reste `Exporter les données JSON`, puis conserver le fichier localement.

## État Render gratuit

Le plan gratuit Render ne permet pas de disque persistant pour SQLite. La base SQLite peut donc être perdue après redémarrage ou redéploiement.

La solution gratuite retenue est donc :

1. Créer une base PostgreSQL gratuite externe.
2. Copier l’URL de connexion.
3. La mettre dans Render avec le nom `DATABASE_URL`.
4. Redéployer le service.

## Ouverture sans serveur

Il est toujours possible d’ouvrir `index.html` directement, mais dans ce mode l’application utilise le stockage du navigateur. Pour un vrai enregistrement dans une base de données, utiliser le fichier `LANCER_APPLICATION_RH.bat`.

## Fonctions incluses

- Tableau de bord RH avec indicateurs clés.
- Fiches collaborateurs avec contrat et solde de congés.
- Import Excel des collaborateurs par matricule Zeus.
- Portail salarié : connexion par matricule, demande de congé et suivi.
- Demande de documents RH : attestation de travail, domiciliation de salaire, bulletin, fiche de congé, attestation de départ en congé annuel, certificat de travail et autres demandes.
- Modèles de documents paramétrables avec remplissage automatique.
- Suivi des contrats avec alertes d’échéance.
- Renouvellement de contrat avec conservation de l’historique.
- Formulaire de demande de congé.
- Calcul automatique des jours de congé selon les jours ouvrés et jours fériés.
- Vérification du solde disponible.
- Workflow Assistant RH → Direction.
- Validation / refus / demande de modification.
- Génération de ticket de congé.
- Calendrier mensuel des congés.
- Détection des chevauchements dans un même service.
- Tableau des reprises de congé.
- Alertes RH centralisées.
- Paramétrage des délais d’alerte.
- Historique et traçabilité des actions.

## Import Excel des collaborateurs

Dans `Collaborateurs`, cliquer sur `Télécharger modèle Excel`, remplir le fichier, puis cliquer sur `Importer Excel`.

Le matricule Zeus est la clé :

- si le matricule existe déjà, la fiche est mise à jour ;
- si le matricule n’existe pas, un nouveau collaborateur est créé.

Colonnes prévues :

- Noms et prénoms
- Matricule
- Date d’embauche
- Date de naissance
- Numéro de téléphone
- Adresse mail
- Numéro CNPS
- Type de contrat
- Fonctions
- Ville de fonction
- Département
- Situation matrimoniale
- Nombre d’enfants
- Date de début de contrat en cours
- Date de fin de contrat en cours
- Soldes de congé à date
- Solde de congé déjà pris
- Date de départ
- Salaire

## Portail salarié

Sur l’écran de connexion, le salarié saisit uniquement son matricule Zeus. Il peut ensuite :

- faire une demande de congé ;
- faire une demande de document ;
- suivre le statut de ses demandes.

## Modèles de documents

Dans `Paramétrage`, la section `Modèles de documents` permet de coller ou modifier les modèles.

Variables disponibles :

`{{nom_complet}}`, `{{matricule}}`, `{{fonction}}`, `{{departement}}`, `{{ville_fonction}}`, `{{type_contrat}}`, `{{date_embauche}}`, `{{date_naissance}}`, `{{date_debut_contrat}}`, `{{date_fin_contrat}}`, `{{date_depart}}`, `{{salaire}}`, `{{telephone}}`, `{{email}}`, `{{cnps}}`, `{{situation_matrimoniale}}`, `{{nombre_enfants}}`, `{{solde_conge}}`, `{{conge_pris}}`, `{{precision}}`, `{{date_jour}}`.

## Données

La version locale utilise une base SQLite structurée avec les tables suivantes :

- `employees`
- `leave_balances`
- `contracts`
- `contract_history`
- `leave_requests`
- `leave_observations`
- `leave_history`
- `documents`
- `audit_log`
- `settings`

La version en ligne gratuite et durable peut utiliser PostgreSQL externe. Dans ce mode, l’état de l’application est conservé dans la table `app_state`.

Pour une version production, il faudra ajouter :

- des comptes utilisateurs sécurisés ;
- des droits par rôle ;
- l’envoi réel d’emails / notifications ;
- le stockage sécurisé des contrats, justificatifs et tickets.

## Nettoyage des anciennes données fictives

Un outil de maintenance est disponible ici :

`maintenance_nettoyer_donnees_fictives.py`

Il supprime uniquement les anciens identifiants fictifs de démonstration et crée automatiquement une sauvegarde dans :

`application-rh/database/backups`
