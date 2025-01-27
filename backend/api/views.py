import base64
from datetime import datetime

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from profiles.models import Profile

PUBLIC_KEY_HEADER = "Public-Key"
TIMESTAMP_HEADER = "Timestamp"
SIGNATURE_HEADER = "Signature"
TIMESTAMP_TOLERANCE = 300


class ProfileView(APIView):

    allowed_methods = ["GET", "POST", "DELETE"]

    def dispatch(self, request, *args, **kwargs):
        if request.method not in self.allowed_methods:
            return Response(
                status=status.HTTP_405_METHOD_NOT_ALLOWED,
            )
        return super().dispatch(request, *args, **kwargs)

    def decode_base64(self, data, field_name):
        try:
            return base64.b64decode(data)
        except Exception:
            raise ValidationError({field_name: f"Invalid {field_name} format"})

    def get_header_data(self, request, header_name):
        data = request.headers.get(header_name)
        if not data:
            raise ValidationError({header_name: f"{header_name} is required"})
        return self.decode_base64(data, header_name)

    def get_body(self, request):
        body = request.body
        if not body:
            raise ValidationError({"Body": "Body is required"})
        return self.decode_base64(request.body, "Body")

    def validate_timestamp(self, timestamp):
        timestamp = int.from_bytes(timestamp, byteorder="little")
        current_timestamp = int(datetime.now().timestamp())

        if abs(current_timestamp - timestamp) > TIMESTAMP_TOLERANCE:
            raise ValidationError({"Timestamp": "Invalid timestamp"})
        return

    def verify_signature(self, verify_key, message, signature):
        try:
            verify_key.verify(message, signature)
        except BadSignatureError:
            raise ValidationError({"Signature": "Invalid signature"})

    def get(self, request):

        public_key = self.get_header_data(request, PUBLIC_KEY_HEADER)
        timestamp = self.get_header_data(request, TIMESTAMP_HEADER)
        signature = self.get_header_data(request, SIGNATURE_HEADER)

        self.validate_timestamp(timestamp)
        self.verify_signature(VerifyKey(public_key), timestamp, signature)

        profile = Profile.objects.filter(
            public_key=request.headers.get(PUBLIC_KEY_HEADER)
        ).first()

        if not profile:
            return Response(status=status.HTTP_403_FORBIDDEN)

        if not profile.services:
            return Response(status=status.HTTP_204_NO_CONTENT)

        return Response(
            profile.services,
            content_type="application/octet-stream",
            status=status.HTTP_200_OK,
        )

    def post(self, request):
        public_key = self.get_header_data(request, PUBLIC_KEY_HEADER)
        body = self.get_body(request)

        signature = body[:64]
        timestamp = body[64:68]
        services = body[68:]

        self.validate_timestamp(timestamp)
        self.verify_signature(
            VerifyKey(public_key), timestamp + services, signature
        )

        profile = Profile.objects.filter(
            public_key=request.headers.get(PUBLIC_KEY_HEADER)
        ).first()

        if not profile:
            return Response(status=status.HTTP_403_FORBIDDEN)

        profile.services = base64.b64encode(services).decode("ascii")
        profile.save()

        return Response(status=status.HTTP_200_OK)

    def delete(self, request):

        public_key = self.get_header_data(request, PUBLIC_KEY_HEADER)
        timestamp = self.get_header_data(request, TIMESTAMP_HEADER)
        signature = self.get_header_data(request, SIGNATURE_HEADER)

        self.validate_timestamp(timestamp)
        self.verify_signature(VerifyKey(public_key), timestamp, signature)

        profile = Profile.objects.filter(
            public_key=request.headers.get(PUBLIC_KEY_HEADER)
        ).first()

        if not profile:
            return Response(status=status.HTTP_403_FORBIDDEN)

        if not profile.services:
            return Response(status=status.HTTP_204_NO_CONTENT)

        profile.services = None
        profile.save()

        return Response(status=status.HTTP_200_OK)
