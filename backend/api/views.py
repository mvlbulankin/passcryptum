import base64
import binascii
import logging
import random
from datetime import datetime
from enum import Enum
from functools import wraps

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from credentials.models import Credential
from profiles.models import Profile

logger = logging.getLogger(__name__)


class AuthConfig:
    PUBLIC_KEY_HEADER = "Public-Key"
    HASHED_PIN_HEADER = "Hashed-Pin"
    PROTECTOR_HEADER = "Protector"
    TIMESTAMP_HEADER = "Timestamp"
    SIGNATURE_HEADER = "Signature"
    TIMESTAMP_TOLERANCE = 300
    MAX_CREDENTIALS_PER_PROFILE = 10


class HttpMethod(Enum):
    GET = "GET"
    POST = "POST"
    DELETE = "DELETE"


def require_auth_headers(required_headers, verify_signature=False):
    """Decorator to enforce required headers and optional signature verification."""
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(self, request, *args, **kwargs):
            header_data = {}
            for header in required_headers:
                header_data[header] = self.get_header_data(request, header)

            if AuthConfig.TIMESTAMP_HEADER in required_headers:
                self.validate_timestamp(header_data[AuthConfig.TIMESTAMP_HEADER])

            if verify_signature and AuthConfig.SIGNATURE_HEADER in required_headers:
                public_key = header_data[AuthConfig.PUBLIC_KEY_HEADER]
                signature = header_data[AuthConfig.SIGNATURE_HEADER]
                timestamp = header_data[AuthConfig.TIMESTAMP_HEADER]
                message = timestamp + (request.body or b"")
                self.verify_signature(VerifyKey(public_key), message, signature)

            request.auth_data = header_data
            return view_func(self, request, *args, **kwargs)
        return wrapper
    return decorator


class BaseAuthMixin:
    """Mixin providing base64 encoding/decoding and authentication utilities."""

    def encode_base64(self, data, field_name):
        """Encode data to base64 ASCII string."""
        try:
            return base64.b64encode(data).decode("ascii")
        except (TypeError, binascii.Error):
            raise ValidationError({field_name: f"Invalid {field_name} format"})

    def decode_base64(self, data, field_name):
        """Decode base64 data to bytes."""
        try:
            return base64.b64decode(data)
        except (TypeError, binascii.Error):
            raise ValidationError({field_name: f"Invalid {field_name} format"})

    def get_header_data(self, request, header_name):
        """Retrieve and decode a header value."""
        data = request.headers.get(header_name)
        if not data:
            raise ValidationError({header_name: f"{header_name} is required"})
        return self.decode_base64(data, header_name)

    def get_body(self, request):
        """Retrieve and decode the request body."""
        body = request.body
        if not body:
            raise ValidationError({"Body": "Body is required"})
        if len(body) < 68:
            raise ValidationError({"Body": "Body is too short"})
        return self.decode_base64(body, "Body")

    def validate_timestamp(self, timestamp):
        """Validate that the timestamp is within tolerance."""
        try:
            timestamp_int = int.from_bytes(timestamp, byteorder="little")
            current_timestamp = int(datetime.now().timestamp())
            if abs(current_timestamp - timestamp_int) > AuthConfig.TIMESTAMP_TOLERANCE:
                raise ValidationError({"Timestamp": "Invalid timestamp"})
        except ValueError:
            raise ValidationError({"Timestamp": "Malformed timestamp"})

    def verify_signature(self, verify_key, message, signature):
        """Verify a cryptographic signature."""
        try:
            verify_key.verify(message, signature)
        except BadSignatureError:
            raise ValidationError({"Signature": "Invalid signature"})


class CredentialView(BaseAuthMixin, APIView):
    """API view for managing credentials."""

    allowed_methods = [
        HttpMethod.GET.value,
        HttpMethod.POST.value,
        HttpMethod.DELETE.value,
    ]

    def dispatch(self, request, *args, **kwargs):
        """Override dispatch to enforce allowed methods."""
        if request.method not in self.allowed_methods:
            return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)
        return super().dispatch(request, *args, **kwargs)

    def generate_protector(self):
        """Generate a random 32-byte protector encoded in base64."""
        random_bytes = bytes([random.randint(0, 255) for _ in range(32)])
        return self.encode_base64(random_bytes, "random_bytes")

    def _get_credential(self, public_key, protector, hashed_pin=None):
        """Retrieve a credential based on provided data."""
        profile = Profile.objects.filter(
            public_key=self.encode_base64(public_key, "public_key")
        ).first()
        if not profile:
            return None

        filters = {
            "profile": profile,
            "protector": self.encode_base64(protector, "protector"),
        }
        if hashed_pin is not None:
            filters["pin"] = self.encode_base64(hashed_pin, "hashed_pin")

        return Credential.objects.filter(**filters).first()

    def _create_credential(self, profile, hashed_pin, entropy):
        """Create or retrieve a credential, enforcing a max of 10 credentials per profile.

        Args:
            profile (Profile): The associated profile.
            hashed_pin (bytes): Decoded hashed PIN.
            entropy (bytes): Decoded entropy.

        Returns:
            str: Base64-encoded protector.
        """
        protector = self.generate_protector()

        credentials = Credential.objects.filter(profile=profile)
        if credentials.count() >= AuthConfig.MAX_CREDENTIALS_PER_PROFILE:
            oldest_credential = credentials.order_by('created_at').first()
            oldest_credential.delete()

        Credential.objects.create(
            profile=profile,
            pin=self.encode_base64(hashed_pin, "hashed_pin"),
            protector=protector,
            entropy=self.encode_base64(entropy, "entropy"),
        )
        return protector

    @require_auth_headers([
        AuthConfig.PUBLIC_KEY_HEADER,
        AuthConfig.HASHED_PIN_HEADER,
        AuthConfig.PROTECTOR_HEADER,
        AuthConfig.TIMESTAMP_HEADER,
    ])
    def get(self, request):
        """Handle GET request to retrieve credential entropy."""
        auth_data = request.auth_data
        public_key = auth_data[AuthConfig.PUBLIC_KEY_HEADER]
        hashed_pin = auth_data[AuthConfig.HASHED_PIN_HEADER]
        protector = auth_data[AuthConfig.PROTECTOR_HEADER]

        credential = self._get_credential(public_key, protector, hashed_pin)
        if not credential:
            return Response(status=status.HTTP_403_FORBIDDEN)

        return Response(
            credential.entropy,
            content_type="application/json",
            status=status.HTTP_200_OK,
        )

    @require_auth_headers([
        AuthConfig.PUBLIC_KEY_HEADER,
        AuthConfig.HASHED_PIN_HEADER,
    ])
    def post(self, request):
        """Handle POST request to create a credential."""
        auth_data = request.auth_data
        public_key = auth_data[AuthConfig.PUBLIC_KEY_HEADER]
        hashed_pin = auth_data[AuthConfig.HASHED_PIN_HEADER]
        body = self.get_body(request)

        signature = body[:64]
        timestamp = body[64:68]
        entropy = body[68:]

        self.validate_timestamp(timestamp)
        self.verify_signature(VerifyKey(public_key), timestamp + entropy, signature)

        profile = Profile.objects.filter(
            public_key=self.encode_base64(public_key, "public_key")
        ).first()
        if not profile:
            return Response(status=status.HTTP_403_FORBIDDEN)

        protector = self._create_credential(profile, hashed_pin, entropy)
        return Response(
            protector,
            content_type="application/json",
            status=status.HTTP_200_OK,
        )

    @require_auth_headers([
        AuthConfig.PUBLIC_KEY_HEADER,
        AuthConfig.PROTECTOR_HEADER,
        AuthConfig.TIMESTAMP_HEADER,
    ])
    def delete(self, request):
        """Handle DELETE request to remove a credential without requiring hashed_pin."""
        auth_data = request.auth_data
        public_key = auth_data[AuthConfig.PUBLIC_KEY_HEADER]
        protector = auth_data[AuthConfig.PROTECTOR_HEADER]

        credential = self._get_credential(public_key, protector)
        if not credential:
            return Response(status=status.HTTP_403_FORBIDDEN)

        credential.delete()
        return Response(status=status.HTTP_200_OK)


class ProfileView(BaseAuthMixin, APIView):
    """API view for managing profiles."""

    allowed_methods = [
        HttpMethod.GET.value,
        HttpMethod.POST.value,
        HttpMethod.DELETE.value,
    ]

    def dispatch(self, request, *args, **kwargs):
        """Override dispatch to enforce allowed methods."""
        if request.method not in self.allowed_methods:
            return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)
        return super().dispatch(request, *args, **kwargs)

    def _get_profile(self, public_key):
        """Retrieve a profile by public key."""
        return Profile.objects.filter(
            public_key=self.encode_base64(public_key, "public_key")
        ).first()

    @require_auth_headers([
        AuthConfig.PUBLIC_KEY_HEADER,
        AuthConfig.TIMESTAMP_HEADER,
        AuthConfig.SIGNATURE_HEADER,
    ], verify_signature=True)
    def get(self, request):
        """Handle GET request to retrieve profile services."""
        auth_data = request.auth_data
        public_key = auth_data[AuthConfig.PUBLIC_KEY_HEADER]

        profile = self._get_profile(public_key)
        if not profile:
            return Response(status=status.HTTP_403_FORBIDDEN)

        if not profile.services:
            return Response(status=status.HTTP_204_NO_CONTENT)

        return Response(
            profile.services,
            content_type="application/json",
            status=status.HTTP_200_OK,
        )

    @require_auth_headers([AuthConfig.PUBLIC_KEY_HEADER])
    def post(self, request):
        """Handle POST request to update profile services."""
        auth_data = request.auth_data
        public_key = auth_data[AuthConfig.PUBLIC_KEY_HEADER]
        body = self.get_body(request)

        signature = body[:64]
        timestamp = body[64:68]
        services = body[68:]

        self.validate_timestamp(timestamp)
        self.verify_signature(VerifyKey(public_key), timestamp + services, signature)

        profile = self._get_profile(public_key)
        if not profile:
            return Response(status=status.HTTP_403_FORBIDDEN)

        profile.services = self.encode_base64(services, "services")
        profile.save()
        return Response(status=status.HTTP_200_OK)

    @require_auth_headers([
        AuthConfig.PUBLIC_KEY_HEADER,
        AuthConfig.TIMESTAMP_HEADER,
        AuthConfig.SIGNATURE_HEADER,
    ], verify_signature=True)
    def delete(self, request):
        """Handle DELETE request to clear profile services."""
        auth_data = request.auth_data
        public_key = auth_data[AuthConfig.PUBLIC_KEY_HEADER]

        profile = self._get_profile(public_key)
        if not profile:
            return Response(status=status.HTTP_403_FORBIDDEN)

        if not profile.services:
            return Response(status=status.HTTP_204_NO_CONTENT)

        profile.services = None
        profile.save()
        return Response(status=status.HTTP_200_OK)
