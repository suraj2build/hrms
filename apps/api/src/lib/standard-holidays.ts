/**
 * standard-holidays.ts
 *
 * Government of India CENTRAL gazetted ("closed") holidays, used to seed a
 * tenant's holiday_calendar in one click. These apply to all employees
 * (holiday_group_id = NULL); states/regions add their own via Holiday Groups.
 *
 * The 3 national holidays (Republic Day, Independence Day, Gandhi Jayanti) have
 * fixed Gregorian dates; festival holidays are lunar and shift each year, so
 * dates are curated per year from the DoPT / published central list. HR should
 * still verify festival dates against the official gazette (moon-sighting dates
 * like Eid can shift by a day). One holiday per date (DB UNIQUE tenant_id,date).
 *
 * Sources: DoPT central holiday list 2026; published India national calendars 2027.
 */

export interface StandardHoliday {
  date: string   // YYYY-MM-DD
  name: string
}

export const CENTRAL_HOLIDAYS_BY_YEAR: Record<number, StandardHoliday[]> = {
  2026: [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-03-04', name: 'Holi' },
    { date: '2026-03-21', name: 'Id-ul-Fitr' },
    { date: '2026-03-26', name: 'Ram Navami' },
    { date: '2026-03-31', name: 'Mahavir Jayanti' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-05-01', name: 'Buddha Purnima' },
    { date: '2026-05-27', name: 'Id-ul-Zuha (Bakrid)' },
    { date: '2026-06-26', name: 'Muharram' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-08-26', name: 'Milad-un-Nabi' },
    { date: '2026-09-04', name: 'Janmashtami' },
    { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
    { date: '2026-10-20', name: 'Dussehra (Vijaya Dashami)' },
    { date: '2026-11-08', name: 'Diwali (Deepavali)' },
    { date: '2026-11-24', name: 'Guru Nanak Jayanti' },
    { date: '2026-12-25', name: 'Christmas Day' },
  ],
  2027: [
    { date: '2027-01-26', name: 'Republic Day' },
    { date: '2027-03-10', name: 'Id-ul-Fitr' },
    { date: '2027-03-22', name: 'Holi' },
    { date: '2027-03-26', name: 'Good Friday' },
    { date: '2027-04-15', name: 'Ram Navami' },
    { date: '2027-04-19', name: 'Mahavir Jayanti' },
    { date: '2027-05-17', name: 'Id-ul-Zuha (Bakrid)' },
    { date: '2027-05-20', name: 'Buddha Purnima' },
    { date: '2027-06-15', name: 'Muharram' },
    { date: '2027-08-15', name: 'Independence Day' },   // Milad-un-Nabi also ~15 Aug 2027; merged (one holiday/date)
    { date: '2027-08-25', name: 'Janmashtami' },
    { date: '2027-10-02', name: 'Mahatma Gandhi Jayanti' },
    { date: '2027-10-10', name: 'Dussehra (Vijaya Dashami)' },
    { date: '2027-10-29', name: 'Diwali (Deepavali)' },
    { date: '2027-11-14', name: 'Guru Nanak Jayanti' },
    { date: '2027-12-25', name: 'Christmas Day' },
  ],
}

export const SUPPORTED_HOLIDAY_YEARS = Object.keys(CENTRAL_HOLIDAYS_BY_YEAR).map(Number)
