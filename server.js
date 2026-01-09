// POSTULARSE A UN TRABAJO
app.post('/postular', async (req, res) => {
    try {
        const { user_id, job_id, ...rest } = req.body;
        if (!user_id || !job_id) {
            return res.status(400).json({ ok: false, error: 'Faltan datos requeridos' });
        }

        // Puedes agregar más validaciones aquí si lo deseas

        const { error } = await supabase
            .from('postulations')
            .insert([{ user_id, job_id, ...rest }]);

        if (error) {
            console.error('Error insertando postulación:', error);
            return res.status(500).json({ ok: false, error: 'Error al postularse', details: error.message });
        }

        return res.json({ ok: true });
    } catch (err) {
        console.error('Error en /postular:', err);
        return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
    }
});
// ...existing code...
import express from 'express';
import deleteUser from './deleteUser.js';
import dotenv from 'dotenv';
import cors from 'cors'; // Importar el middleware de CORS
import { createClient } from '@supabase/supabase-js';

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


// Función para enviar mail con Brevo API
async function sendBrevoEmail({ to, subject, html }) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': process.env.BREVO_API_KEY,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sender: {
                email: process.env.BREVO_SENDER,
                name: 'Gremio'
            },
            to: [{ email: to }],
            subject,
            htmlContent: html
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
    }
}

// Crear servidor
const app = express();

// Configurar CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
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

    const { data: user, error } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

    if (error || !user) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await supabase.from('password_resets').insert({
        user_id: user.id,
        token,
        expires_at: expiresAt
    });

    const frontendUrl = process.env.FRONTEND_URL || 'https://tusitio.com';
    const link = `${frontendUrl}/reset-password.html?token=${token}`;



                sendBrevoEmail({
                    to: email,
                    subject: 'Recuperar contraseña',
                    html: `<a href="${link}">Restablecer contraseña</a>`
                }).catch(err => {
                    console.error('Error enviando mail con Brevo:', err.message);
                });

    res.json({ ok: true });
});

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

/* LOGIN */
app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ ok: false, error: 'Faltan datos' });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, password_hash, perfil_completo')
            .eq('email', email)
            .single();

        if (error || !user || !user.password_hash) {
            return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ ok: false, error: 'Credenciales inválidas' });
        }

        return res.json({
            ok: true,
            user: {
                id: user.id,
                email: user.email,
                perfil_completo: user.perfil_completo
            }
        });

    } catch (err) {
        console.error('Error en login:', err);
        return res.status(500).json({ ok: false, error: 'Error interno' });
    }
});

// Puerto del servidor

/* OBTENER USUARIO POR ID */
app.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, role, perfil_completo, avatar_url')
            .eq('id', id)
            .single();

        if (error || !user) {
            return res.status(404).json({ ok: false });
        }

        return res.json({ ok: true, user });

    } catch (err) {
        console.error('Error obteniendo usuario:', err);
        return res.status(500).json({ ok: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
        console.log(`Servidor escuchando en el puerto ${PORT}`);
        console.log(`Variables de entorno cargadas: SUPABASE_URL=${!!process.env.SUPABASE_URL}, SERVICE_ROLE_KEY=${!!process.env.SERVICE_ROLE_KEY}`);
});
