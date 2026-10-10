# Mise à jour du serveur OLYCITY vers 1.0.7

Le serveur existant se met à jour avec son script. Aucun nouveau ZIP à importer, aucune réinstallation de Forge.

1. Prévenir les joueurs et arrêter le serveur Minecraft avec le bouton **Arrêter** de Crafty. Attendre la fin de l’arrêt.
2. Faire une sauvegarde complète dans Crafty, comprenant le monde et ses données de joueurs/progression. Conserver cette sauvegarde.
3. Ouvrir un terminal Linux dans le conteneur Crafty et aller dans le dossier de ce serveur : celui qui contient `olycity-update.sh`, `server.properties`, `mods/` et `world/`. Ce n’est pas la console Minecraft de Crafty.
4. Vérifier `java -version` : il faut **Java 17** pour l’outil et pour le lancement du serveur.
5. Dans ce dossier, exécuter :

```sh
sh olycity-update.sh 1.0.7 --serveur-arrete
```

6. Attendre la fin et le message **Serveur mis a jour vers 1.0.7**. En cas d’erreur, garder le serveur arrêté et transmettre la sortie de la commande. Le script conserve une copie des fichiers précédents dans `olycity-update-backups/`.
7. Démarrer le serveur dans Crafty avec la commande habituelle Java 17. Attendre **Done** dans les logs. Vérifier `cat olycity-server-version.txt` : il doit afficher `1.0.7`.

Ensuite, les joueurs ferment Minecraft et relancent la même instance Prism OLYCITY. La mise à jour se télécharge au lancement ; laisser la commande Packwiz autorisée. Ne pas créer une nouvelle instance.

## Accès au terminal du conteneur

Si le terminal est ouvert sur l’hôte Docker, `docker ps` donne le nom du conteneur Crafty. Entrer ensuite avec `docker exec -it NOM_DU_CONTENEUR sh`, puis `cd "CHEMIN_DU_DOSSIER_SERVEUR"`. Remplacer ces deux valeurs par celles de l’installation. Le chemin du serveur se lit dans la configuration du serveur dans Crafty. Le `java` utilisé dans ce terminal doit aussi être Java 17 ; le choix Java dans Crafty ne change pas forcément le PATH du terminal.

## Contrôles après démarrage

- Les joueurs peuvent rejoindre avec la version 1.0.7.
- Le bouton de transfert JEI remplit la grille avec les ingrédients disponibles.
- Les quêtes s’ouvrent et la progression précédente reste présente.
- Les élevages existants sont présents ; rechercher les nouveaux poulets dans des biomes adaptés.
- Les nouveaux coffres et la table d’enchantement sont accessibles.

Le patch ajoute Chaos Persists, Sophisticated Storage et l’enchantement d’Apotheosis, met Modern Chickens à jour et ajoute JEI/FindMe/AppleSkin au serveur. Hats Classic est reporté car son JAR provoque un crash serveur ; Simple Hats est conservé. Les mods de performance supplémentaires restent de côté.

Ne pas supprimer `world/`, ses données FTB, `ops.json`, `server.properties` ou `eula.txt`. La mise à jour ne remplace pas ces fichiers. Les nouveaux éléments de génération ne remplacent pas les zones déjà construites ; du nouveau terrain peut être nécessaire pour certaines structures.

Pour revenir en arrière après avoir joué sur 1.0.7, restaurer la sauvegarde complète faite avant le patch : revenir uniquement aux anciens mods ne suffit pas si le monde contient les nouveaux objets.
