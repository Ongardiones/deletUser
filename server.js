import express from 'express';
import deleteUser from './deleteUser.js';
import dotenv from 'dotenv';
import cors from 'cors'; // Importar el middleware de CORS
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// Cargar variables de entorno desde .env
dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SERVICE_ROLE_KEY,
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    }
);

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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


import crypto from 'crypto';
import bcrypt from 'bcrypt';

/* RECUPERAR CONTRASEÑA */
app.post('/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.json({ ok: true });

    const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await supabase.from('password_resets').insert({
        user_id: user.id,
        token,
        expires_at: expiresAt
    });

    const link = `${process.env.FRONTEND_URL}/reset-password.html?token=${token}`;



        transporter.sendMail({
            to: email,
            subject: 'Recuperar contraseña',
            html: `<a href="${link}">Restablecer contraseña</a>`
        }).catch(err => {
            console.error('Error enviando mail:', err.message);
        });

    res.json({ ok: true });
});

/* RESET CONTRASEÑA */
app.post('/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password)
        return res.status(400).json({ ok: false });

    const { data: reset } = await supabase
        .from('password_resets')
        .select('*')
        .eq('token', token)
        .eq('used', false)
        .single();

    if (!reset || new Date(reset.expires_at) < new Date())
        return res.status(400).json({ ok: false });

    const hash = await bcrypt.hash(password, 10);

    await supabase.from('users')
        .update({ password_hash: hash })
        .eq('id', reset.user_id);

    await supabase.from('password_resets')
        .update({ used: true })
        .eq('id', reset.id);

    res.json({ ok: true });
});

// Puerto del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
        console.log(`Servidor escuchando en el puerto ${PORT}`);
        console.log(`Variables de entorno cargadas: SUPABASE_URL=${!!process.env.SUPABASE_URL}, SERVICE_ROLE_KEY=${!!process.env.SERVICE_ROLE_KEY}`);
});
