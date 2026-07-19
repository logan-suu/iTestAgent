import UIKit

class DetailViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let nib = UINib(nibName: "DetailView", bundle: nil)
    }
}

protocol DetailDelegate {
    func detailDidClose()
}
