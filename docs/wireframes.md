# Wireframes

## Landing and signup

```
+----------------------------------+
| BookSpace                        |
| Create a department  [ Sign up ] |
| Sign in to demo      [ Demo ]    |
+----------------------------------+

+----------------------------------+
| Create a department              |
| Name / Slug / Timezone           |
| Admin name / email / password    |
| [ Create department ]            |
+----------------------------------+
```

## Sign in (`/o/:slug/login`)

```
+----------------------------------+
| BookSpace · {department name}    |
| Accounts come from an admin      |
| Email    [________________]      |
| Password [________________]      |
| [ Sign in ]                      |
+----------------------------------+
```

A forced password change replaces the app until the temporary password is replaced. Confirm the new password before continuing.

## Catalogue and resource (`/o/:slug/resources`)

```
Search [____] Type [All v] Location [All v]
+------------------+  +------------------+
| Computer Lab A   |  | Seminar Room B   |
| Room · approval  |  | Confirms now     |
| [ View ]         |  | [ View ]         |
+------------------+  +------------------+

Resource
[ Previous week ] [ Next week ]
Mon Tue Wed Thu Fri Sat Sun
08 Free Free Confirmed ...
09 ...
Date [____] Start [____] End [____]
Purpose [________________]
[ Submit request ]
Nearby free slots: [ Use 14:00 ]
```

Confirmed, pending, and blocked cells include those words, not color alone. Admin management covers policy, hours, blocks, and approvers on the same page.

## Queue and admin

Approvers see pending requests for assigned resources. Admins manage users (edit, roles, activate), resources, reports with filters/CSV, audit history, and department timezone settings.
