// jezo-eventkit: reads the Mac's calendars through EventKit for Jezo's main
// process, which runs it and reads JSON from stdout (docs/design/calendar.md).
// This includes the Google, Exchange and iCloud accounts added in System Settings.
//
//   jezo-eventkit status                 -> {"access": "full" | "notDetermined" | "denied" | "restricted" | "writeOnly"}
//   jezo-eventkit request                -> asks for full access, then prints the status
//   jezo-eventkit calendars              -> the calendars and the account each belongs to
//   jezo-eventkit events FROM TO [IDS…]  -> events between two local dates (YYYY-MM-DD, TO exclusive), repeats
//                                           expanded; all-day events as dates, their end the day after
//   jezo-eventkit watch                  -> prints "changed" whenever the calendar store changes, until stdin closes

import EventKit
import Foundation

let store = EKEventStore()

func emit(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(1)
}

func access() -> String {
  switch EKEventStore.authorizationStatus(for: .event) {
  case .fullAccess: return "full"
  case .writeOnly: return "writeOnly"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "notDetermined"
  @unknown default: return "denied"
  }
}

/** Local time without a zone, the way Jezo writes times: 2026-09-29T09:30. */
let local: DateFormatter = {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy-MM-dd'T'HH:mm"
  return f
}()

let day: DateFormatter = {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy-MM-dd"
  return f
}()

func hex(_ color: CGColor?) -> String? {
  guard let c = color?.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
        let parts = c.components, parts.count >= 3 else { return nil }
  return String(format: "#%02x%02x%02x", Int(parts[0] * 255), Int(parts[1] * 255), Int(parts[2] * 255))
}

func sourceKind(_ source: EKSource) -> String {
  switch source.sourceType {
  case .local: return "local"
  case .exchange: return "exchange"
  case .calDAV: return "caldav"
  case .mobileMe: return "icloud"
  case .subscribed: return "subscribed"
  case .birthdays: return "birthdays"
  @unknown default: return "other"
  }
}

let args = CommandLine.arguments.dropFirst()
switch args.first {
case "status":
  emit(["access": access()])

case "request":
  let done = DispatchSemaphore(value: 0)
  store.requestFullAccessToEvents { _, _ in done.signal() }
  done.wait()
  emit(["access": access()])

case "calendars":
  guard access() == "full" else { fail("No access to calendars.") }
  emit(store.calendars(for: .event).map { cal -> [String: Any] in
    var c: [String: Any] = [
      "id": cal.calendarIdentifier,
      "title": cal.title,
      "writable": cal.allowsContentModifications,
      "account": ["id": cal.source.sourceIdentifier, "title": cal.source.title, "kind": sourceKind(cal.source)],
    ]
    if let color = hex(cal.cgColor) { c["color"] = color }
    return c
  })

case "events":
  guard access() == "full" else { fail("No access to calendars.") }
  let rest = Array(args.dropFirst())
  guard rest.count >= 2, let from = day.date(from: rest[0]), let to = day.date(from: rest[1]) else {
    fail("Usage: jezo-eventkit events FROM TO [CALENDAR_IDS…]")
  }
  let wanted = Set(rest.dropFirst(2))
  let calendars = store.calendars(for: .event).filter { wanted.isEmpty || wanted.contains($0.calendarIdentifier) }
  // EventKit searches at most four years at a time; Jezo asks for weeks.
  let found = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: calendars))
  let calendar = Calendar.current
  emit(found.map { e -> [String: Any] in
    // All-day events end at 23:59:59 of their last day here; Jezo's end is exclusive, the next day.
    let start = e.isAllDay ? day.string(from: e.startDate) : local.string(from: e.startDate)
    let end = e.isAllDay
      ? day.string(from: calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: e.endDate.addingTimeInterval(-1)))!)
      : local.string(from: e.endDate)
    var event: [String: Any] = [
      // One id per occurrence: a repeating event shares its identifier across occurrences.
      "id": "\(e.eventIdentifier ?? e.calendarItemIdentifier)@\(local.string(from: e.occurrenceDate ?? e.startDate))",
      "calendar": e.calendar.calendarIdentifier,
      "title": e.title ?? "",
      "start": start,
      "end": end,
      "allDay": e.isAllDay,
      "repeats": e.hasRecurrenceRules,
    ]
    if let location = e.location, !location.isEmpty { event["location"] = location }
    if let notes = e.notes, !notes.isEmpty { event["notes"] = notes }
    if let url = e.url { event["url"] = url.absoluteString }
    if e.status == .canceled { event["cancelled"] = true }
    return event
  })

case "watch":
  NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { _ in
    print("changed")
    fflush(stdout)
  }
  // Jezo closes stdin when it quits, so the helper doesn't outlive it.
  FileHandle.standardInput.readabilityHandler = { handle in
    if handle.availableData.isEmpty { exit(0) }
  }
  RunLoop.main.run()

default:
  fail("Usage: jezo-eventkit status | request | calendars | events FROM TO [IDS…] | watch")
}
