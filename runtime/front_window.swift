// Print the CGWindowID of the frontmost on-screen normal (layer 0) window, or exit 1.
import Foundation
import CoreGraphics

let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
if let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] {
    for win in list {
        let layer = (win[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
        if layer == 0 {
            if let num = (win[kCGWindowNumber as String] as? NSNumber)?.intValue, num > 0 {
                print(num)
                exit(0)
            }
        }
    }
}
exit(1)
