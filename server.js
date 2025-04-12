import express from 'express';
import deleteUser from './deleteUser.js';
import dotenv from 'dotenv';

// Cargar variables de entorno desde .env
dotenv.config();

// Crear servidor
const app = express();

// Permite leer JSON en las solicitudes
app.use(express.json());

// Ruta que usará la función deleteUser
app.post('/delete-user', deleteUser);

// Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
