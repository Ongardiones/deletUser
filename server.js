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
    origin: '*', // Permitir solicitudes desde cualquier origen
    methods: ['POST', 'OPTIONS'], // Métodos permitidos
    allowedHeaders: ['Content-Type'], // Encabezados permitidos
}));

// Permite leer JSON en las solicitudes
app.use(express.json());

// Ruta de health check
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Servidor funcionando correctamente' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ruta que usará la función deleteUser
app.post('/delete-user', deleteUser);

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    res.status(500).json({ 
        success: false, 
        error: 'Error interno del servidor',
        details: err.message 
    });
});

// Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
    console.log(`Variables de entorno cargadas: SUPABASE_URL=${!!process.env.SUPABASE_URL}, SERVICE_ROLE_KEY=${!!process.env.SERVICE_ROLE_KEY}`);
});
