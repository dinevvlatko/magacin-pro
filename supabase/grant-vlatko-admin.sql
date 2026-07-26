update public.profiles
set role = 'admin', active = true
where lower(email) = 'vlatko_dinev@hotmail.com';

select id, email, full_name, role, active
from public.profiles
where lower(email) = 'vlatko_dinev@hotmail.com';
