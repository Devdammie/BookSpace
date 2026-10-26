# Wireframes

## Sign in

```
+----------------------------------+
| BookSpace                        |
| Email    [________________]      |
| Password [________________]      |
| [ Sign in ]                      |
+----------------------------------+
```

A forced password change replaces the app until the temporary password is replaced.

## Catalogue and resource

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

Confirmed, pending, and blocked cells include those words, not color alone.

## Queue and admin

The approval queue is one card per request with Approve and Reject. Reject needs a reason.

Admin tabs: resources, users, reports, audit, settings. Creating a user shows the temporary password once. Cancelling a confirmed booking asks for a second confirmation.
