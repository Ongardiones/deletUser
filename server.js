
// ORDEN RECOMENDADO
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import deleteUser from './deleteUser.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

dotenv.config();

// crear app PRIMERO
const app = express();

// middlewares
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

// supabase
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
    const controller = new AbortController();
    const timeoutMs = 10_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
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
            }),
            signal: controller.signal
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(error);
        }
    } finally {
        clearTimeout(timeoutId);
    }
}

// Verificación de correo (código por email) - en memoria
const CODIGOS_VERIFICACION = {}; // email -> { codigo, timestamp }
const EXPIRACION_CODIGO_MS = 5 * 60 * 1000;
const COOLDOWN_ENVIO_MS = 60 * 1000;
const ULTIMO_ENVIO = {}; // email -> timestamp

function normalizarEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function secondsLeft(msLeft) {
    return Math.max(0, Math.ceil(msLeft / 1000));
}

app.post('/enviar-codigo', async (req, res) => {
    try {
        const email = normalizarEmail(req.body?.email);
        if (!email) return res.status(400).json({ ok: false, message: 'Falta el correo' });

        const now = Date.now();
        const last = ULTIMO_ENVIO[email] || 0;
        const msSince = now - last;

        if (msSince < COOLDOWN_ENVIO_MS) {
            return res.status(429).json({
                ok: false,
                message: 'Esperá antes de reenviar el código.',
                retryAfterSec: secondsLeft(COOLDOWN_ENVIO_MS - msSince),
                expiresInSec: secondsLeft(EXPIRACION_CODIGO_MS)
            });
        }

        const codigo = Math.floor(100000 + Math.random() * 900000).toString();
        CODIGOS_VERIFICACION[email] = { codigo, timestamp: now };
        // Bloquear reintentos inmediatos aunque falle el envío (evita spam accidental)
        ULTIMO_ENVIO[email] = now;

        try {
            await sendBrevoEmail({
                to: email,
                subject: '✨ Verifica tu cuenta · Gremio',
                html: `
                  <div style="font-family: Arial, sans-serif;">
                    <h2>Código de verificación</h2>
                    <p>Tu código es:</p>
                    <h1>${codigo}</h1>
                    <p>Este código es válido por 5 minutos.</p>
                  </div>
                `
            });

            return res.json({
                ok: true,
                message: 'Código enviado',
                expiresInSec: secondsLeft(EXPIRACION_CODIGO_MS),
                resendInSec: secondsLeft(COOLDOWN_ENVIO_MS)
            });
        } catch (err) {
            // Si no se pudo enviar, invalidar el código para evitar que quede activo sin correo.
            delete CODIGOS_VERIFICACION[email];
            console.error('Error enviando mail con Brevo:', err?.message || err);
            return res.status(500).json({ ok: false, message: 'Error al enviar correo' });
        }
    } catch (err) {
        console.error('Error en /enviar-codigo:', err);
        return res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
});

app.post('/verificar-codigo', (req, res) => {
    try {
        const email = normalizarEmail(req.body?.email);
        const codigoIngresado = String(req.body?.codigoIngresado || '').trim();

        if (!email || !codigoIngresado) {
            return res.status(400).json({ ok: false, message: 'Faltan datos' });
        }

        const registro = CODIGOS_VERIFICACION[email];
        if (!registro) return res.status(401).json({ ok: false, message: 'Código incorrecto' });

        const { codigo, timestamp } = registro;
        const ahora = Date.now();
        if (ahora - timestamp > EXPIRACION_CODIGO_MS) {
            delete CODIGOS_VERIFICACION[email];
            return res.status(401).json({ ok: false, message: 'Código expirado' });
        }

        if (codigo === codigoIngresado) {
            delete CODIGOS_VERIFICACION[email];
            return res.json({ ok: true, message: 'Código correcto' });
        }

        return res.status(401).json({ ok: false, message: 'Código incorrecto' });
    } catch (err) {
        console.error('Error en /verificar-codigo:', err);
        return res.status(500).json({ ok: false, message: 'Error interno del servidor' });
    }
});

// RUTAS
app.post('/postular', async (req, res) => {
    try {
        const { user_id, job_id } = req.body;

        if (!user_id || !job_id) {
            return res.status(400).json({ ok: false, error: 'Faltan datos requeridos' });
        }

        const { error } = await supabase
            .from('postulaciones')
            .insert([{
                trabajador_id: user_id,
                trabajo_id: job_id,
                estado: 'postulado'
            }]);

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    ok: false,
                    error: 'Ya estás postulado a este trabajo'
                });
            }
            console.error('Error insertando postulación:', error);
            return res.status(500).json({ ok: false, error: 'Error al postularse' });
        }

        return res.json({ ok: true });

    } catch (err) {
        console.error('Error en /postular:', err);
        return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
    }
});

app.post('/delete-user', deleteUser);

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

// Mis trabajos (trabajador): devuelve jobs asociados por postulaciones
// Nota: usa SERVICE_ROLE_KEY, por lo que no depende de RLS del cliente.
app.get('/mis-trabajos/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) return res.status(400).json({ ok: false, error: 'Falta userId' });

        const { data: postulaciones, error: errPost } = await supabase
            .from('postulaciones')
            .select('trabajo_id, estado, created_at')
            .eq('trabajador_id', userId)
            .order('created_at', { ascending: false });

        if (errPost) {
            console.error('Error obteniendo postulaciones:', errPost);
            return res.status(500).json({ ok: false, error: 'Error obteniendo postulaciones' });
        }

        const ids = Array.from(new Set((postulaciones || []).map(p => p.trabajo_id).filter(Boolean)));
        if (ids.length === 0) {
            return res.json({ ok: true, jobs: [] });
        }

        const { data: jobs, error: errJobs } = await supabase
            .from('jobs')
            .select('*, users(name, avatar_url)')
            .in('id', ids);

        if (errJobs) {
            console.error('Error obteniendo jobs:', errJobs);
            return res.status(500).json({ ok: false, error: 'Error obteniendo trabajos' });
        }

        const jobById = new Map((jobs || []).map(j => [String(j.id), j]));

        const merged = (postulaciones || [])
            .map(p => {
                const job = jobById.get(String(p.trabajo_id));
                if (!job) return null;
                return {
                    ...job,
                    postulacion_estado: p.estado,
                    postulacion_creada_at: p.created_at,
                };
            })
            .filter(Boolean);

        return res.json({ ok: true, jobs: merged });
    } catch (err) {
        console.error('Error en /mis-trabajos:', err);
        return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
    }
});

// Perfil completo (lectura): users + curriculums + experiencia + educacion + enlaces + testimonios
// Nota: usa SERVICE_ROLE_KEY, por lo que NO depende de la sesión Supabase del navegador.
app.get('/perfil-completo/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ ok: false, error: 'Falta id' });

        const { data: user, error: errUser } = await supabase
            .from('users')
            .select('id, email, role, perfil_completo, avatar_url, name, phone, provincia, localidad')
            .eq('id', id)
            .maybeSingle();

        if (errUser) {
            console.error('Error leyendo users:', errUser);
            return res.status(500).json({ ok: false, error: 'Error leyendo user' });
        }
        if (!user) return res.status(404).json({ ok: false, error: 'User no encontrado' });

        // Traer currículum del usuario. Si hubiese más de uno, priorizar el activo y/o el más reciente.
        const { data: curriculum, error: errCv } = await supabase
            .from('curriculums')
            .select('*')
            .eq('user_id', id)
            .order('is_active', { ascending: false })
            .order('actualizado_en', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (errCv) {
            console.error('Error leyendo curriculums:', errCv);
            return res.status(500).json({ ok: false, error: 'Error leyendo currículum' });
        }

        let experiencia = [];
        let educacion = [];
        if (curriculum?.id) {
            const { data: expRows, error: errExp } = await supabase
                .from('experiencia_laboral')
                .select('empresa, puesto, descripcion, inicio, fin')
                .eq('curriculum_id', curriculum.id)
                .order('inicio', { ascending: false });
            if (errExp) console.error('Error leyendo experiencia_laboral:', errExp);
            experiencia = expRows || [];

            const { data: eduRows, error: errEdu } = await supabase
                .from('educacion')
                .select('institucion, titulo, descripcion, inicio, fin')
                .eq('curriculum_id', curriculum.id)
                .order('inicio', { ascending: false });
            if (errEdu) console.error('Error leyendo educacion:', errEdu);
            educacion = eduRows || [];
        }

        // Enlaces/testimonios: en el front se guardan con curriculum_id = userId
        const { data: enlaces, error: errLinks } = await supabase
            .from('enlaces_portfolio')
            .select('tipo, url')
            .eq('curriculum_id', id);
        if (errLinks) console.error('Error leyendo enlaces_portfolio:', errLinks);

        const { data: testimonios, error: errTest } = await supabase
            .from('testimonios')
            .select('autor, mensaje')
            .eq('curriculum_id', id);
        if (errTest) console.error('Error leyendo testimonios:', errTest);

        return res.json({
            ok: true,
            user,
            curriculum: curriculum || null,
            experiencia: experiencia || [],
            educacion: educacion || [],
            enlaces: enlaces || [],
            testimonios: testimonios || [],
        });
    } catch (err) {
        console.error('Error en /perfil-completo:', err);
        return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
    }
});

app.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: user, error } = await supabase
            .from('users')
            .select('id, email, role, perfil_completo, avatar_url, name, phone, provincia, localidad')
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

// health
app.get('/', (req, res) => res.json({ ok: true }));
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error no manejado:', err);
    res.status(500).json({
        success: false,
        error: 'Error interno del servidor',
        details: err.message
    });
});

// listen SIEMPRE al final
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
    console.log(`Variables de entorno cargadas: SUPABASE_URL=${!!process.env.SUPABASE_URL}, SERVICE_ROLE_KEY=${!!process.env.SERVICE_ROLE_KEY}`);
});
