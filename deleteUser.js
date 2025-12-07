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

        // PASO 1: Eliminar del sistema de autenticación primero
        console.log('Paso 1: Eliminando de Auth...');
        const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);

        if (deleteAuthError) {
            console.error('ERROR en Auth:', deleteAuthError);
            return res.status(500).json({
                success: false,
                error: 'Error al eliminar usuario de Auth: ' + deleteAuthError.message
            });
        }
        console.log('✓ Usuario eliminado de Auth exitosamente');

        // PASO 2: Eliminar avatar del storage
        console.log('Paso 2: Eliminando avatar...');
        try {
            const { data: userData } = await supabase
                .from('users')
                .select('avatar_url')
                .eq('id', userId)
                .maybeSingle();

            if (userData?.avatar_url) {
                const avatarPath = userData.avatar_url.split('/avatars/')[1]?.split('?')[0];
                if (avatarPath) {
                    await supabase.storage.from('avatars').remove([avatarPath]);
                    console.log('✓ Avatar eliminado');
                }
            } else {
                console.log('- Sin avatar para eliminar');
            }
        } catch (err) {
            console.warn('Advertencia al eliminar avatar:', err.message);
        }

        // PASO 3: Eliminar datos relacionados
        console.log('Paso 3: Eliminando datos relacionados...');
        
        // Comentarios (ignorar si no existen)
        const { error: commentsError } = await supabase
            .from('comments')
            .delete()
            .eq('user_id', userId);
        
        if (commentsError && commentsError.code !== 'PGRST116') {
            console.warn('Advertencia al eliminar comentarios:', commentsError.message);
        } else {
            console.log('✓ Comentarios procesados');
        }

        // Trabajos (ignorar si no existen)
        const { error: jobsError } = await supabase
            .from('jobs')
            .delete()
            .eq('user_id', userId);
        
        if (jobsError && jobsError.code !== 'PGRST116') {
            console.warn('Advertencia al eliminar trabajos:', jobsError.message);
        } else {
            console.log('✓ Trabajos procesados');
        }

        // Curriculum (ignorar si no existe)
        const { error: curriculumsError } = await supabase
            .from('curriculums')
            .delete()
            .eq('user_id', userId);
        
        if (curriculumsError && curriculumsError.code !== 'PGRST116') {
            console.warn('Advertencia al eliminar curriculum:', curriculumsError.message);
        } else {
            console.log('✓ Curriculum procesado');
        }

        // PASO 4: Eliminar de la tabla users
        console.log('Paso 4: Eliminando de tabla users...');
        const { error: userError } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);

        if (userError && userError.code !== 'PGRST116') {
            console.warn('Advertencia al eliminar de users:', userError.message);
            console.log('Continuando... (Auth ya fue eliminado)');
        } else {
            console.log('✓ Usuario eliminado de tabla users');
        }

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
