# Identifying a person

Four operations can hand you a `vanId`, and picking the wrong one is the most
common way to corrupt a VAN database — usually by creating a duplicate of someone
who was already there.

## Choose by what you already hold

| You have | Use | Why |
| --- | --- | --- |
| A `vanId` | [`getPerson`](../operations/getPerson.md) | Nothing to match |
| A strong identifier — email, phone, or name plus one of those | [`findPerson`](../operations/findPerson.md) | Makes an identity claim, never writes |
| Only a name, a city, a partial anything | [`searchPeople`](../operations/searchPeople.md) | No threshold; returns candidates for you to judge |
| A strong identifier, and you want the person to exist afterwards | [`findOrCreatePerson`](../operations/findOrCreatePerson.md) | Matches first, creates only on a miss |
| Certainty that this is a new person | [`createPerson`](../operations/createPerson.md) | Never deduplicates |

## The trap

`findPerson` does not attempt a match until the criteria reach one of these
combinations:

- first name + last name + **email**
- first name + last name + **phone**
- first name + last name + **zip5** + **date of birth**
- first name + last name + **street number + street name + zip5**
- **email** alone, or **phone** alone

Anything less — a name on its own, name + date of birth, name + ZIP — returns
`404 Unmatched` **no matter who is in the database**. It is not a 400, and nothing
in the response distinguishes "you didn't give me enough" from "this person isn't
here".

So: **never treat a `findPerson` 404 as proof of absence.** If you follow one with
a create, you will duplicate real people. `findOrCreatePerson` has the same
threshold and does exactly that on your behalf — silently.

## The safe sequence

When you hold a strong identifier, one call does it:

```bash
curl -sS -X POST 'https://api.securevan.com/v4/people/find' \
  -u "app-name:$NGP_API_KEY|1" \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Harriet","lastName":"Kowalski",
       "emails":[{"email":"harriet.kowalski@example.com"}]}'
# → 302  {"vanId": 100000001, "status": "Matched"}
# → 404  {"vanId": null, "status": "Unmatched"}
```

When you don't, search first and judge the candidates yourself:

```bash
curl -sS -u "app-name:$NGP_API_KEY|1" \
  'https://api.securevan.com/v4/people?firstName=Harriet&lastName=Kowalski&$expand=emails,phones'
```

`searchPeople` matches case-insensitive **prefixes**, so `Kowal` finds Kowalski and
`owalski` finds nothing. Expand the collections you need to tell people apart —
without `$expand` they come back `null`, not empty.

## Reading the answer

- `302` carries only a stub, `{"vanId": …, "status": "Matched"}`, plus a `Location`
  header. Follow it, or call `getPerson`, to see the actual record.
- A `302` when **several** people match is still a single id, with nothing marking
  the match as ambiguous. With duplicates, name-based criteria return the
  first-created record.
- A `vanId` in the request body overrides every other criterion and skips the
  threshold entirely.

## After you have the id

- Adding a phone, email, or address with
  [`updatePerson`](../operations/updatePerson.md) **appends**. It never replaces,
  so writing back a record you just read will duplicate its contact methods.
- Collapsing two records is [`mergePerson`](../operations/mergePerson.md), which is
  irreversible. Dry-run it with `whatIf` — which accepts only the literal `true`.

## Related

- [`find-minimum-match-combinations`](../behaviors/find-minimum-match-combinations.md)
  — the recorded probe behind the table above
- [`findorcreate-below-threshold-creates-a-duplicate`](../behaviors/findorcreate-below-threshold-creates-a-duplicate.md)
  — the failure mode, on tape
- [`find-returns-first-created-duplicate`](../behaviors/find-returns-first-created-duplicate.md)
