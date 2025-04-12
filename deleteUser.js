import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL; // Leer la URL desde las variables de entorno
const serviceRoleKey = process.env.SERVICE_ROLE_KEY; // Leer la clave desde las variables de entorno
const supabase = createClient(supabaseUrl, serviceRoleKey);

export default async function deleteUser(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'Falta el userId' });
    }

    try {
        const { error } = await supabase.auth.admin.deleteUser(userId);
        if (error) {
            throw error;
        }

        res.status(200).json({ message: 'Usuario eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar el usuario:', error.message);
        res.status(500).json({ error: 'Error al eliminar el usuario' });
    }
}
