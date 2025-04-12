import express from 'express';
import deleteUser from './deleteUser.js';
import dotenv from 'dotenv';
import cors from 'cors'; // Importar el middleware de CORS

// Cargar variables de entorno desde .env
dotenv.config();

// Crear servidor
const app = express();

// Configurar CORS
app.use(cors({
    origin: 'http://127.0.0.1:5500', // Permitir solicitudes desde este origen
    methods: ['POST', 'OPTIONS'], // Métodos permitidos
    allowedHeaders: ['Content-Type'], // Encabezados permitidos
}));

// Permite leer JSON en las solicitudes
app.use(express.json());

// Ruta que usará la función deleteUser
app.post('/delete-user', deleteUser);

// Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
