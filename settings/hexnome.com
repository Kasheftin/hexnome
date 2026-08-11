server {
    server_name hexnome.com www.hexnome.com;
    root /home/www/hexnome;
    access_log /home/logs/hexnome/nginx.access.log;
    error_log /home/logs/hexnome/nginx.error.log;

    location /.well-known {
        access_log off;
        error_log off;
        root /home/www/hexnome;
        try_files $uri =404;
    }

    location /api {
        proxy_pass http://localhost:22466;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        root /home/www/hexnome/frontend/dist;
        try_files $uri /index.html;
    }

    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/hexnome.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/hexnome.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot


}
server {
    if ($host = www.hexnome.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    if ($host = hexnome.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name hexnome.com www.hexnome.com;
    return 404; # managed by Certbot




}