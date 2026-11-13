# Fee Recovery promo script (about 60s)

**Persona:** Priya runs Riverbend Animal Rescue, a fictional small nonprofit that takes donations through WP Simple Pay.

**Numbers used throughout (keep these identical in every scene):**

- Donation: $50
- Stripe fee: 2.9% + $0.30 = $1.75
- Donations per year: 1,200
- Donor opt-in rate: 72%
- Kept per year: $1,512

| # | Time | Headline (word by word, **bold** = highlight sweep) | On screen | Viewer feels |
|---|---|---|---|---|
| 1 | 0–5s | "Every donation. **Fully received.**" | A $50.00 donation card floats in, centered, with nothing deducted | Curiosity |
| 2 | 5–11s | "Not **$1.75 lost** to fees." | The same card. A "Stripe fee −$1.75" line slides in and the total ticks down to **$48.25**, then a counter rolls up: "1,200 donations a year = **$2,100 gone**" | Recognition (the pain) |
| 3 | 11–16s | "Meet **Fee Recovery**" | A WordPress admin mockup with the WP Simple Pay form builder open on "Riverbend Donations" | Interest |
| 4 | 16–23s | "Set it **once**" | The camera zooms into the Payment Methods panel. An animated cursor opens the Card fee settings and types **2.9%** + **$0.30** | Easy |
| 5 | 23–29s | "Let donors **choose**" | The cursor drags the **Fee Recovery Toggle** field into the form, then adds **Amount Breakdown**. Panels around them blur. | Control, no pressure |
| 6 | 29–37s | "Donors see **exactly** what they cover" | Front-end form on the donor's side. A checkbox reads "I'd like to cover the processing fee." It gets ticked, the breakdown animates to *Donation $50.00 · Processing fee $1.80 · **Total $51.80***, and the Payment Element card fills in | Trust, transparency |
| 7 | 37–43s | "Priya gets **$50.00**. Not $48.25." | A success page, then a "payment received" card showing **Net: $50.00** with a green check | Relief (emotional peak) |
| 8 | 43–50s | "Most donors **say yes**" | A stat card pops out showing "**72%** opted in", followed by a second card with "**$1,512 kept** this year · same donors" | Want |
| 9 | 50–55s | "Bank payments? **Capped.**" | The cursor switches the method to ACH Direct Debit and sets **Maximum fee: $5.00**, and the breakdown on a $500 gift updates live to "$5.00" | It thought of everything |
| 10 | 55–60s | End card: "Keep every dollar they give." | The WP Simple Pay logo and a "Get WP Simple Pay →" button. Small text below: "Fee Recovery on all licenses for cards" | Action |

## Math check

- To net $50, the charge is $50.30 ÷ 0.971 = **$51.80**. Stripe takes 2.9% of $51.80 plus $0.30, which is $1.80, leaving exactly $50.00.
- Without recovery: $50 × 2.9% + $0.30 = $1.75, so Priya nets $48.25. Across 1,200 donations that's $2,100 a year.
- The $1,512 comes from 864 opt-ins (72% of 1,200) × $1.75.

## Accuracy notes

Source: WP Simple Pay docs, "How to Recover Stripe Processing Fees".

- The toggle text in scene 6 ("I'd like to cover the processing fee.") is **draft wording**. The label is set per form, so in a real form it can say anything.
- Fee Recovery **doesn't work on forms with taxes or coupons**, so the mockup form mustn't show a coupon field.
- Fee Recovery on cards works with every license. **ACH and other payment methods (scene 9) need a Plus license or higher.** Either leave scene 10's footnote as it is, or add "Plus+" to scene 9.
- The Amount Breakdown field labels the fee line "Processing fee" (the plugin's real string).

## Alternatives

- **Persona:** swap the nonprofit for a yoga studio selling $120 class packs if you're aiming at businesses rather than donations. If you do, redo the math.
- **Scene 9:** switch it to a monthly donation toggle instead of the ACH fee cap. Check that fees carry over to subscriptions before you use this.
