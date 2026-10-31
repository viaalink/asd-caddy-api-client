# Wizards for the fiddly parts

**Route Configuration Wizard**: host or path matching, then a reverse proxy, file server, redirect or static response, plus security headers and compression.

**Security Configuration Wizard**: local users, LDAP, GitHub/Google OAuth2 or any OIDC provider, a login portal and authorization policies. The JSON comes from the same builders as `@viaalink/caddy-api-client`, so it is exactly what caddy-security expects (including the `%s` LDAP placeholder and cookie lifetimes in seconds).
