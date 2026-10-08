# OLYCITY V1 — installation du serveur

Version **1.0.3** · Minecraft **1.20.1** · Forge **47.4.10** · Java **17**

Le ZIP contient le serveur complet et ses outils de mise à jour.

## Installation dans Crafty Controller

1. Télécharge **OLYCITY V1 - Serveur.zip**. Dans Crafty, crée un serveur Minecraft Java avec **Import from ZIP / Zip Import**.
2. Importe le ZIP et sélectionne la racine contenant `mods`, `libraries`, `server.properties` et `run.sh`. Si le téléversement est trop volumineux, place le ZIP dans `/crafty/import` et utilise l’import local.
3. Nomme le serveur **OLYCITY V1** et utilise le port **25565**. Si ce port est déjà occupé, choisis un port libre et adapte `server-port` dans `server.properties` ainsi que les ports Docker.
4. Si Crafty exige un JAR à l’import, sélectionne `forge-1.20.1-47.4.10-installer.jar`. Avant de démarrer, remplace la commande d’exécution par :

```sh
java -Xms2G -Xmx10G @libraries/net/minecraftforge/forge/1.20.1-47.4.10/unix_args.txt nogui
```

Utilise **Java 17** et la racine du serveur comme dossier de travail. La commande réserve jusqu’à **10 Go de RAM**.

5. Accepte l’EULA dans Crafty, puis démarre le serveur. Attends le message `Done (...)!` avant de te connecter.
6. Communique l’adresse et le port aux joueurs. Ils utilisent le pack OLYCITY dans Prism Launcher.

## Ports Docker et réseau

Ajoute ces ports au service Crafty existant, en conservant ses autres ports et volumes :

```yaml
ports:
  - "25565:25565/tcp"
  - "24454:24454/udp"
```

Ouvre aussi ces ports dans le pare-feu et sur le routeur si nécessaire. **24454/UDP** sert au chat vocal. Si ce port est occupé, adapte également `config/voicechat/voicechat-server.properties`.

## Réglages

- Survie, difficulté normale, 12 joueurs maximum.
- Skybreacoeur possède les droits administrateur.
- Sauvegardes automatiques toutes les 30 minutes, 24 archives conservées. Garde aussi une copie hors du serveur.

## Mettre à jour le serveur

Lorsqu’une nouvelle version est annoncée :

1. Arrête le serveur dans Crafty et fais une sauvegarde complète, monde compris.
2. Ouvre un terminal dans le conteneur et place-toi à la racine du serveur.
3. Remplace `NUMERO` par la version communiquée et lance :

```sh
sh olycity-update.sh NUMERO --serveur-arrete
```

4. Attends la confirmation de réussite, puis redémarre le serveur.
5. Les joueurs ferment Minecraft et relancent leur instance Prism pour recevoir la mise à jour.

Le monde, les droits administrateur et les paramètres du serveur sont conservés. Si la mise à jour échoue, garde le serveur arrêté et restaure la sauvegarde complète.

## Alternative sans Crafty

Décompresse le ZIP dans un dossier dédié, accepte l’EULA dans `eula.txt`, puis utilise le fichier Docker Compose fourni :

```sh
docker compose up -d
docker compose logs -f
```

Choisis une seule méthode de lancement : Crafty ou Docker autonome.
