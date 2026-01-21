// deleteUser.js - Función para eliminar un usuario de Supabase
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

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

export default async function deleteUser(req, res) {
    try {
        const { userId } = req.body;

        // Seguridad: este endpoint usa SERVICE_ROLE_KEY, así que SIEMPRE validamos identidad acá.
        // Solo permitimos que el usuario elimine su propia cuenta.
        const authHeader = String(req.headers?.authorization || '').trim();
        const token = authHeader.toLowerCase().startsWith('bearer ')
            ? authHeader.slice(7).trim()
            : '';
        if (!token) {
            return res.status(401).json({ success: false, error: 'Falta Authorization Bearer token' });
        }

        const { data: authData, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !authData?.user?.id) {
            return res.status(401).json({ success: false, error: 'Token inválido o expirado' });
        }
        if (String(authData.user.id) !== String(userId)) {
            return res.status(403).json({ success: false, error: 'No autorizado para eliminar esta cuenta' });
        }

        console.log('=== INICIO PROCESO DE ELIMINACIÓN ===');
        console.log('UserID recibido:', userId);
        console.log('Variables de entorno:', {
            url: process.env.SUPABASE_URL ? 'Configurada' : 'NO configurada',
            key: process.env.SERVICE_ROLE_KEY ? 'Configurada' : 'NO configurada'
        });

        if (!userId) {
            console.log('ERROR: userId no proporcionado');
            return res.status(400).json({
                success: false,
                error: 'userId es requerido'
            });
        }

        const safe = async (label, fn) => {
            try {
                await fn();
                console.log(`✓ ${label}`);
            } catch (err) {
                console.warn(`Advertencia en ${label}:`, err?.message || err);
            }
        };

        const safeDelete = async (table, builderFn) => {
            try {
                const q = supabase.from(table).delete();
                const { error } = await builderFn(q);
                if (error) {
                    const msg = String(error?.message || '').toLowerCase();
                    const missing = (error?.status === 404) || msg.includes('could not find') || msg.includes('not found');
                    if (missing) return;
                    console.warn(`Advertencia al eliminar en ${table}:`, error.message);
                }
            } catch (err) {
                const msg = String(err?.message || '').toLowerCase();
                if (msg.includes('could not find') || msg.includes('not found')) return;
                console.warn(`Advertencia al eliminar en ${table}:`, err?.message || err);
            }
        };

        const safeUpdate = async (table, values, builderFn) => {
            try {
                const q = supabase.from(table).update(values);
                const { error } = await builderFn(q);
                if (error) {
                    const msg = String(error?.message || '').toLowerCase();
                    const missing = (error?.status === 404) || msg.includes('could not find') || msg.includes('not found');
                    if (missing) return;
                    console.warn(`Advertencia al actualizar en ${table}:`, error.message);
                }
            } catch (err) {
                const msg = String(err?.message || '').toLowerCase();
                if (msg.includes('could not find') || msg.includes('not found')) return;
                console.warn(`Advertencia al actualizar en ${table}:`, err?.message || err);
            }
        };

        // PASO 1: Leer user + jobs (para borrar storage y dependencias)
        console.log('Paso 1: Preparando borrado (fetch user/jobs)...');
        const { data: userRow } = await supabase
            .from('users')
            .select('id, avatar_url, role')
            .eq('id', userId)
            .maybeSingle();

        const { data: jobsOwned } = await supabase
            .from('jobs')
            .select('id')
            .eq('user_id', userId);

        const ownedJobIds = Array.isArray(jobsOwned) ? jobsOwned.map(j => j.id).filter(v => v !== null && v !== undefined) : [];
        const ownedJobIdStrings = ownedJobIds.map(v => String(v));

        // PASO 2: Borrar storage (avatar + imágenes de ofertas)
        console.log('Paso 2: Eliminando archivos de Storage...');
        await safe('Avatar (bucket avatars)', async () => {
            const avatarUrl = String(userRow?.avatar_url || '').trim();
            if (!avatarUrl) return;
            // Soporta URLs públicas de Supabase Storage: /storage/v1/object/public/<bucket>/<path>
            const m = avatarUrl.match(/\/storage\/v1\/object\/public\/([^\/]+)\/(.+?)(\?|$)/i);
            if (!m) return;
            const bucket = m[1];
            const path = m[2];
            if (!bucket || !path) return;
            await supabase.storage.from(bucket).remove([path]);
        });

        await safe('Imágenes de ofertas (bucket job-images)', async () => {
            if (!ownedJobIds.length) return;
            for (const jobId of ownedJobIds) {
                const prefix = `${String(userId)}/${String(jobId)}`;
                // Listado por páginas (por si hay muchas)
                let offset = 0;
                const limit = 100;
                // eslint-disable-next-line no-constant-condition
                while (true) {
                    const { data: files, error: listErr } = await supabase.storage
                        .from('job-images')
                        .list(prefix, { limit, offset });
                    if (listErr) break;
                    const names = (files || []).map(f => f?.name).filter(Boolean);
                    if (!names.length) break;
                    const paths = names.map(name => `${prefix}/${name}`);
                    await supabase.storage.from('job-images').remove(paths);
                    if (names.length < limit) break;
                    offset += limit;
                }
            }
        });

        // PASO 3: Eliminar datos relacionados (best-effort)
        console.log('Paso 3: Eliminando datos relacionados...');

        // Presencia / sugerencias / resets
        await safeDelete('user_presence', (q) => q.eq('user_id', userId));
        await safeDelete('user_suggestions', (q) => q.eq('user_id', userId));
        await safeDelete('password_resets', (q) => q.eq('user_id', userId));

        // Comentarios (si existe)
        await safeDelete('comments', (q) => q.eq('user_id', userId));

        // Cancelaciones por acuerdo (si existe)
        await safeDelete('job_cancellation_requests', (q) => q.or(`requested_by.eq.${userId},requested_to.eq.${userId}`));
        if (ownedJobIdStrings.length) {
            // También borrar por job_id (columna es text)
            await safeDelete('job_cancellation_requests', (q) => q.in('job_id', ownedJobIdStrings));
        }

        // Postulaciones: del usuario (como trabajador) y de sus trabajos
        await safeDelete('postulaciones', (q) => q.eq('trabajador_id', userId));
        if (ownedJobIds.length) {
            await safeDelete('postulaciones', (q) => q.in('trabajo_id', ownedJobIds));
        }

        // Si el usuario estaba asignado como trabajador en jobs ajenos, desasignar.
        // Si el trabajo estaba en curso, marcarlo como cancelado (no tocamos finalizados/u otros).
        const { data: assignedJobs } = await supabase
            .from('jobs')
            .select('id, estado')
            .eq('trabajador_id', userId);
        const assignedJobIds = Array.isArray(assignedJobs) ? assignedJobs.map(j => j.id).filter(v => v !== null && v !== undefined) : [];
        if (assignedJobIds.length) {
            await safeUpdate('jobs', { trabajador_id: null }, (q) => q.in('id', assignedJobIds));

            const inProgressIds = (assignedJobs || [])
                .filter(j => String(j?.estado || '').toLowerCase() === 'en_curso')
                .map(j => j.id)
                .filter(v => v !== null && v !== undefined);
            if (inProgressIds.length) {
                await safeUpdate('jobs', { estado: 'cancelado' }, (q) => q.in('id', inProgressIds));
            }
        }

        // Solicitudes de contacto CV (si existe). Igual puede cascadear por FK.
        await safeDelete('cv_contact_requests', (q) => q.or(`employer_id.eq.${userId},worker_id.eq.${userId}`));

        // Currículum + dependientes
        const { data: cvs } = await supabase
            .from('curriculums')
            .select('id')
            .eq('user_id', userId);
        const cvIds = Array.isArray(cvs) ? cvs.map(r => r.id).filter(Boolean) : [];
        if (cvIds.length) {
            await safeDelete('experiencia_laboral', (q) => q.in('curriculum_id', cvIds));
            await safeDelete('educacion', (q) => q.in('curriculum_id', cvIds));
        }

        // Enlaces/testimonios: según tu backend, usan curriculum_id = userId
        await safeDelete('enlaces_portfolio', (q) => q.eq('curriculum_id', userId));
        await safeDelete('testimonios', (q) => q.eq('curriculum_id', userId));

        // Currículums
        await safeDelete('curriculums', (q) => q.eq('user_id', userId));

        // Trabajos del usuario (empleador)
        if (ownedJobIds.length) {
            await safeDelete('jobs', (q) => q.in('id', ownedJobIds));
        } else {
            await safeDelete('jobs', (q) => q.eq('user_id', userId));
        }

        // PASO 4: Eliminar de la tabla users (perfil)
        console.log('Paso 4: Eliminando fila en users...');
        await safeDelete('users', (q) => q.eq('id', userId));

        // PASO 5: Eliminar del sistema de autenticación (Auth) al final
        console.log('Paso 5: Eliminando de Auth...');
        const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);
        if (deleteAuthError) {
            console.error('ERROR en Auth:', deleteAuthError);
            return res.status(500).json({
                success: false,
                error: 'Error al eliminar usuario de Auth: ' + deleteAuthError.message
            });
        }
        console.log('✓ Usuario eliminado de Auth exitosamente');

        console.log('=== PROCESO COMPLETADO EXITOSAMENTE ===');
        return res.status(200).json({
            success: true,
            message: 'Usuario eliminado correctamente'
        });

    } catch (error) {
        console.error('=== ERROR CRÍTICO ===');
        console.error('Tipo:', error.constructor.name);
        console.error('Mensaje:', error.message);
        console.error('Stack:', error.stack);
        return res.status(500).json({
            success: false,
            error: error.message || 'Error al eliminar el usuario',
            details: error.toString()
        });
    }
}
