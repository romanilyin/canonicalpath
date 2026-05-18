class CanonicalPathHttpClient {
  final String baseUrl;

  const CanonicalPathHttpClient({this.baseUrl = 'http://127.0.0.1:8765'});

  Future<String> normalizeViaDaemon(String raw) async {
    throw UnimplementedError(
      'Planned target: implement daemon HTTP transport in Dart',
    );
  }
}
