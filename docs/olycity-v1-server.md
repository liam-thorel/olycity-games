# OLYCITY V1 — installation pour Romain

Version du pack **1.0.1** · Minecraft Java1.20.1 · Forge47.4.10 · Java17 · Linux

Le ZIP serveur contient Forge installé, ses bibliothèques, les mods retenus pour le serveur, les configurations, les quêtes, les livres et les scripts OLYCITY. **Tout est déjà inclus dans ce seul ZIP : correctif TARDIS 1.0.1, installateur Packwiz et script de mise à jour. Aucun kit séparé à télécharger, aucune mise à jour à appliquer avant le premier lancement.** Ne pas importer le ZIP joueur dans Crafty. Aucun monde de test personnel n'est fourni : le serveur créera un monde neuf.

## Import dans ton Crafty existant — solution recommandée

1. Télécharge **OLYCITY V1 - Serveur.zip**. Dans Crafty, choisis la création d'un serveur Minecraft Java, puis **Import from ZIP / Zip Import**.
2. Téléverse le ZIP. Si le navigateur refuse un fichier aussi gros, dépose-le dans le dossier d'import du conteneur Crafty (`/crafty/import`) et utilise l'import local du ZIP.
3. Sélectionne la racine contenant `mods`, `libraries`, `server.properties` et `run.sh`.
4. Nom dans Crafty : **OLYCITY V1**. Port : **25565**, ou un autre port libre si un serveur existant l'utilise déjà. Dans ce cas, modifier aussi `server-port` dans `server.properties` et les ports Docker.
5. Si le formulaire exige un fichier exécutable JAR, choisis `forge-1.20.1-47.4.10-installer.jar`, puis **remplace la commande d'exécution avant de démarrer** par celle ci-dessous. Ne pas lancer l'installateur avec `-jar` comme s'il s'agissait du serveur.
6. Commande d'exécution :

```sh
java -Xms2G -Xmx10G @libraries/net/minecraftforge/forge/1.20.1-47.4.10/unix_args.txt nogui
```

Le `java` choisi doit être **Java17**. Si Crafty utilise une autre version par défaut, utiliser le chemin complet de Java17 dans cette commande. Le dossier de travail doit être la racine du serveur importé, pas le dossier de l'installateur ou celui de Crafty.

7. Enregistre, démarre et accepte toi-même l'EULA proposée par Crafty. Le fichier livré indique `eula=false` volontairement. L'acceptation autorisée par Nico pour le test local ne remplace pas ton acceptation en tant qu'hébergeur.
8. Attends le message `Done (...)!`. Les premiers chargements et la génération du monde peuvent prendre plusieurs minutes. Donne ensuite aux joueurs l'adresse de ton serveur et le port si ce n'est pas25565.

L'archive prépare le contenu du serveur ; elle ne peut pas créer automatiquement une entrée dans ta base Crafty sans accès à ton instance. Le nom et la commande se saisissent à l'import comme ci-dessus.

Documentation : [import ZIP Crafty](https://docs.craftycontrol.com/pages/user-guide/server-creation/minecraft/), [lancement Forge](https://docs.craftycontrol.com/pages/user-guide/faq/).

## Ports du conteneur Linux et du routeur

Le conteneur Crafty existant doit publier les ports de ce serveur :

```yaml
ports:
  - "25565:25565/tcp"
  - "24454:24454/udp"
```

Conserve les ports déjà présents dans ton fichier Docker Compose, notamment ceux du panneau Crafty et des autres serveurs. Ce fragment s'ajoute au service Crafty existant ; il ne remplace pas toute sa configuration. Le port24454/UDP concerne Simple Voice Chat ; utiliser un autre port UDP si un autre serveur l'occupe et modifier aussi `config/voicechat/voicechat-server.properties`.

Ne monte jamais le dossier racine `/` de Linux dans le conteneur. Conserve les volumes persistants de Crafty pour les serveurs et les sauvegardes. [Documentation Docker Crafty](https://docs.craftycontrol.com/pages/getting-started/installation/docker/).

## Alternative : Docker autonome, sans Crafty

Décompresse le ZIP dans un dossier dédié. Accepte l'EULA en modifiant `eula.txt` si tu l'as lue et acceptée, puis utilise le `compose.yaml` fourni :

```sh
docker compose up -d
docker compose logs -f
```

Cette alternative ne gère pas le serveur dans ton panneau Crafty. Ne lance pas les deux variantes sur les mêmes ports ou sur le même monde simultanément.

## Réglages préparés

- Mémoire recommandée :2Go au démarrage et10Go au maximum, sur ton serveur32Go. Ajuster après observation des performances, pas besoin de donner toute la RAM à Java.
- Survie, difficulté normale, pas de hardcore,12places, distance de vue8 et simulation6.
- Authentification officielle activée. RCON désactivé. Vol autorisé pour éviter les expulsions liées aux déplacements des mods.
- **Skybreacoeur est opérateur niveau4**, niveau vanilla maximal, avec contournement de la limite de joueurs. UUID vérifié auprès de Mojang. Le compte d'ISEVEN_7 n'est pas rendu opérateur automatiquement : Nico a demandé ses propres droits.
- `/oly livre`, `/oly quetes`, `/report bug ...`, `/report idee ...` accessibles aux joueurs. Attribution des reliques et réinitialisation des délais réservées aux opérateurs.
- Essential retiré ; FTB Essentials conservé pour `/home`, `/spawn`, `/tpa`.
- Sauvegardes FTB toutes les30min,24archives. Choisir des horaires distincts si Crafty fait aussi des sauvegardes, et garder une copie hors de la machine.
- FTB Chunks garde les zones sélectionnées chargées sans restriction de terrain, maximum25chunks par équipe, tant qu'un membre de l'équipe est connecté. Les upgrades de chargement d'autres mods peuvent avoir leurs propres règles.
- Tornades et aspiration des blocs conservées, déflecteur150blocs ; orientation initiale vers les joueurs désactivée. Accidents nucléaires conservés. Coffres Lootr protégés des explosions.
- Titre visible : **OLYCITY V1**, cyan et gras. Description sur la deuxième ligne : **Welcome to Tel Aviv 🇮🇱 ✡**. Les caractères sont encodés correctement ; le rendu des emoji dépend des polices du client Minecraft.
- L'image fournie est dans `server-icon.png`, au format64×64PNG.

## Si tu importes un ancien monde

Ne copie pas un ancien monde par-dessus le serveur pendant qu'il tourne. Sauvegarde-le d'abord. Les `defaultconfigs` ne remplacent pas automatiquement les réglages d'un monde existant : vérifier son dossier `serverconfig`. Les nouveaux donjons et biomes se généreront surtout dans des régions encore inexplorées.

## Mises à jour suivantes — déjà équipé dans ce ZIP

Le serveur livré est prêt en **1.0.1**. Ne lance pas cette commande pour la première installation : importe le ZIP et démarre normalement après configuration de Crafty et acceptation de l’EULA.

Pour un correctif futur, uniquement après publication et validation de son numéro :

1. Arrêter le serveur dans Crafty et faire une sauvegarde complète, monde compris.
2. Dans le terminal du conteneur, se placer à la racine du serveur importé.
3. Exécuter la commande suivante en remplaçant `NUMERO` par la version communiquée :

```sh
sh olycity-update.sh NUMERO --serveur-arrete
```

4. Attendre la réussite de la synchronisation, puis redémarrer dans Crafty et vérifier les logs.
5. Les joueurs relancent leur instance Prism pour recevoir la même version stable.

Le script crée une copie du contenu géré dans `olycity-update-backups` ; la sauvegarde complète du monde reste nécessaire. Il ne touche pas à `world`, `ops.json`, `server.properties` ou à l’EULA. La version du serveur est choisie volontairement : aucune mise à jour automatique au démarrage.

Si une synchronisation échoue, garder le serveur arrêté et restaurer la sauvegarde complète dans un dossier propre. Ne jamais mélanger les mods de deux versions ni écraser le monde avec le ZIP d’une mise à jour. Les migrations Minecraft/Forge/Java et les réglages `world/serverconfig` d’un monde existant sont traités séparément.

## TARDIS

`/oly tardis` crée une cabine de test équipée, pour les opérateurs. La récupération du bloc extérieur absent est intégrée à cette version. `/oly tardis reparer`, près d’une cabine posée dont le bloc principal manque, restaure son extérieur en conservant l’intérieur. Les passages Immersive Portals sont conservés.
