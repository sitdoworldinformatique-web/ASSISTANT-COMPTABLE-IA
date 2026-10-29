// Point d'entrée de la fonction Appwrite (Node.js). Voir appwrite/LISEZMOI.md.
import * as sdk from "node-appwrite";
import {creerGestionnaire} from "./gestionnaire.js";

export default creerGestionnaire(sdk);
