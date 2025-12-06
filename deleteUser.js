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

        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'userId es requerido'
            });
        }

        console.log('Intentando eliminar usuario:', userId);

        // 1. Eliminar avatar del storage (si existe)
        try {
            const { data: userData } = await supabase
                .from('users')
                .select('avatar_url')
                .eq('id', userId)
                .single();

            if (userData?.avatar_url) {
                const avatarPath = userData.avatar_url.split('/avatars/')[1]?.split('?')[0];
                if (avatarPath) {
                    await supabase.storage.from('avatars').remove([avatarPath]);
                    console.log('Avatar eliminado');
                }
            }
        } catch (err) {
            console.warn('No se pudo eliminar el avatar:', err.message);
        }

        // 2. Eliminar comentarios del usuario
        const { error: commentsError } = await supabase
            .from('comments')
            .delete()
            .eq('user_id', userId);

        if (commentsError) {
            console.warn('Error al eliminar comentarios:', commentsError);
        } else {
            console.log('Comentarios eliminados');
        }

        // 3. Eliminar ofertas de trabajo del usuario
        const { error: jobsError } = await supabase
            .from('jobs')
            .delete()
            .eq('user_id', userId);

        if (jobsError) {
            console.warn('Error al eliminar trabajos:', jobsError);
        } else {
            console.log('Trabajos eliminados');
        }

        // 4. Eliminar datos del curriculum si existen
        const { error: curriculumError } = await supabase
            .from('curriculums')
            .delete()
            .eq('user_id', userId);

        if (curriculumError) {
            console.warn('Error al eliminar curriculum:', curriculumError);
        } else {
            console.log('Curriculum eliminado');
        }

        // 5. Eliminar de la tabla users
        const { error: userError } = await supabase
            .from('users')
            .delete()
            .eq('id', userId);

        if (userError) {
            console.error('Error al eliminar de tabla users:', userError);
            throw userError;
        }

        console.log('Usuario eliminado de tabla users');

        // 6. Eliminar del sistema de autenticación (Auth)
        const { data: deleteAuthData, error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);

        if (deleteAuthError) {
            console.error('Error al eliminar de Auth:', deleteAuthError);
            throw deleteAuthError;
        }

        console.log('Usuario eliminado exitosamente de Auth');

        return res.status(200).json({
            success: true,
            message: 'Usuario eliminado correctamente'
        });

    } catch (error) {
        console.error('Error en deleteUser:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Error al eliminar el usuario'
        });
    }
}
