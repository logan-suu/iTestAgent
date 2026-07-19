import UIKit

class LoginViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
    }
}

class SettingsViewController: UITableViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
    }
}

class HomeViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
    }
}

class ProfileViewController: UIViewController, ProfileDelegate {
    override func viewDidLoad() {
        super.viewDidLoad()
    }
}

protocol ProfileDelegate {
    func didUpdateProfile()
}

protocol DataFetching {
    func fetchData() async throws -> Data
}

struct ContentView: View {
    var body: some View {
        Text("Hello")
    }
}

struct SettingsView: View {
    var body: some View {
        Text("Settings")
    }
}
