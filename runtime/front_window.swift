// Print the CGWindowID of the window to show:
//   argv[1] — an app name (or bundle id) to match by owner; the frontmost normal window
//             owned by that app wins. Without it, or on no match, the frontmost normal
//             (layer 0) on-screen window is printed. Exits 1 when no window exists.
import Foundation
import CoreGraphics

let target = CommandLine.arguments.count > 1 ? CommandLine.arguments[1].lowercased() : nil
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]

guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { exit(1) }

func normalWindowId(_ win: [String: Any]) -> Int? {
    let layer = (win[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
    guard layer == 0 else { return nil }
    let num = (win[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
    return num > 0 ? num : nil
}

if let target = target, !target.isEmpty {
    for win in list {
        let owner = (win[kCGWindowOwnerName as String] as? String ?? "").lowercased()
        if !owner.isEmpty && (owner.contains(target) || target.contains(owner)) {
            if let id = normalWindowId(win) { print(id); exit(0) }
        }
    }
}

// Fallback: the frontmost normal window.
for win in list {
    if let id = normalWindowId(win) { print(id); exit(0) }
}
exit(1)
